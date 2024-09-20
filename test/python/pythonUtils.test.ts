import fs from 'fs';
import { PythonShell } from 'python-shell';
import { getEnvString } from '../../src/envars';
import logger from '../../src/logger';
import { execAsync } from '../../src/python/execAsync';
import * as pythonUtils from '../../src/python/pythonUtils';

jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  promises: {
    writeFile: jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn(),
  },
}));

jest.mock('python-shell', () => {
  const mPythonShell = {
    run: jest.fn(),
  };
  return { PythonShell: jest.fn(() => mPythonShell) };
});

jest.mock('../../src/logger', () => ({
  default: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}));

jest.mock('../../src/envars', () => ({
  getEnvString: jest.fn(),
}));

jest.mock('../../src/python/execAsync', () => ({
  execAsync: jest.fn(),
}));

describe('pythonUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pythonUtils.state.cachedPythonPath = null;
  });

  describe('tryPath', () => {
    it('should return the path for a valid Python 3 executable', async () => {
      jest.mocked(execAsync).mockResolvedValue({
        stdout: 'Python 3.8.10\n',
        stderr: '',
      });

      const result = await pythonUtils.tryPath('/usr/bin/python3');
      expect(result).toBe('/usr/bin/python3');
      expect(execAsync).toHaveBeenCalledWith('/usr/bin/python3 --version');
    });

    it('should return null for a non-existent executable', async () => {
      jest.mocked(execAsync).mockRejectedValue(new Error('Command failed'));

      const result = await pythonUtils.tryPath('/usr/bin/nonexistent');
      expect(result).toBeNull();
      expect(execAsync).toHaveBeenCalledWith('/usr/bin/nonexistent --version');
    });

    it('should return null if the command times out', async () => {
      jest.useFakeTimers();
      jest.mocked(execAsync).mockImplementation(() => {
        const promise = new Promise((resolve) => {
          setTimeout(() => resolve({ stdout: 'Python 3.8.10\n', stderr: '' }), 500);
        }) as any;
        promise.child = { kill: jest.fn() };
        return promise;
      });

      const resultPromise = pythonUtils.tryPath('/usr/bin/python3');
      jest.advanceTimersByTime(251);
      const result = await resultPromise;

      expect(result).toBeNull();
      expect(execAsync).toHaveBeenCalledWith('/usr/bin/python3 --version');
      jest.useRealTimers();
    });
  });

  describe('validatePythonPath', () => {
    it('should validate an existing Python 3 path', async () => {
      jest.mocked(execAsync).mockResolvedValue({
        stdout: 'Python 3.8.10\n',
        stderr: '',
      });

      const result = await pythonUtils.validatePythonPath('python', false);
      expect(result).toBe('python');
      expect(pythonUtils.state.cachedPythonPath).toBe('python');
      expect(execAsync).toHaveBeenCalledWith('python --version');
    });

    it('should return the cached path on subsequent calls', async () => {
      pythonUtils.state.cachedPythonPath = '/usr/bin/python3';
      const result = await pythonUtils.validatePythonPath('python', false);
      expect(result).toBe('/usr/bin/python3');
    });

    it('should fall back to alternative paths for non-existent programs when not explicit', async () => {
      jest
        .mocked(execAsync)
        .mockRejectedValueOnce(new Error('Command failed'))
        .mockResolvedValueOnce({ stdout: 'Python 3.9.5\n', stderr: '' });

      const result = await pythonUtils.validatePythonPath('non_existent_program', false);
      expect(result).toBe(process.platform === 'win32' ? 'py -3' : 'python3');
      expect(execAsync).toHaveBeenCalledTimes(2);
    });

    it('should throw an error for non-existent programs when explicit', async () => {
      jest.mocked(execAsync).mockRejectedValue(new Error('Command failed'));

      await expect(pythonUtils.validatePythonPath('non_existent_program', true)).rejects.toThrow(
        /Python 3 not found\. Tried "non_existent_program"/,
      );
      expect(execAsync).toHaveBeenCalledWith('non_existent_program --version');
    });

    it('should throw an error when no valid Python path is found', async () => {
      jest.mocked(execAsync).mockRejectedValue(new Error('Command failed'));

      await expect(pythonUtils.validatePythonPath('python', false)).rejects.toThrow(
        /Python 3 not found\. Tried "python" and ".+"/,
      );
      expect(execAsync).toHaveBeenCalledTimes(2);
    });

    it('should use PROMPTFOO_PYTHON environment variable when provided', async () => {
      jest.mocked(getEnvString).mockReturnValue('/custom/python/path');
      jest.mocked(execAsync).mockResolvedValue({
        stdout: 'Python 3.8.10\n',
        stderr: '',
      });

      const result = await pythonUtils.validatePythonPath('/custom/python/path', true);
      expect(result).toBe('/custom/python/path');
      expect(execAsync).toHaveBeenCalledWith('/custom/python/path --version');
    });
  });

  describe('runPython', () => {
    beforeEach(() => {
      pythonUtils.state.cachedPythonPath = '/usr/bin/python3';
    });

    it('should correctly run a Python script with provided arguments and read the output file', async () => {
      const mockOutput = JSON.stringify({ type: 'final_result', data: 'test result' });

      jest.mocked(fs.writeFileSync).mockImplementation();
      jest.mocked(fs.readFileSync).mockReturnValue(mockOutput);
      jest.mocked(fs.unlinkSync).mockImplementation();
      (PythonShell.run as jest.Mock).mockImplementation((_, __, callback) => callback(null));

      const result = await pythonUtils.runPython('testScript.py', 'testMethod', [
        'arg1',
        { key: 'value' },
      ], { logLevel: 'INFO' });

      expect(result).toBe('test result');
      expect(PythonShell.run).toHaveBeenCalledWith(
        'wrapper.py',
        expect.objectContaining({
          args: expect.arrayContaining([
            expect.stringContaining('testScript.py'),
            'testMethod',
            'INFO',
            expect.stringContaining('promptfoo-python-input-json'),
            expect.stringContaining('promptfoo-python-output-json'),
          ]),
        }),
        expect.any(Function)
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('promptfoo-python-input-json'),
        expect.any(String),
        'utf-8',
      );
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('promptfoo-python-output-json'),
        'utf-8',
      );
      expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    });

    it('should throw an error if the Python script execution fails', async () => {
      (PythonShell.run as jest.Mock).mockImplementation((_, __, callback) => callback(new Error('Test Error')));

      await expect(pythonUtils.runPython('testScript.py', 'testMethod', ['arg1'], { logLevel: 'INFO' })).rejects.toThrow(
        'Error running Python script: Test Error',
      );
      expect(PythonShell.run).toHaveBeenCalledWith(
        'wrapper.py',
        expect.objectContaining({
          args: expect.arrayContaining([
            expect.stringContaining('testScript.py'),
            'testMethod',
            'INFO',
            expect.stringContaining('promptfoo-python-input-json'),
            expect.stringContaining('promptfoo-python-output-json'),
          ]),
        }),
        expect.any(Function)
      );
    });

    it('should handle Python script returning incorrect result type', async () => {
      const mockOutput = JSON.stringify({ type: 'unexpected_result', data: 'test result' });

      jest.mocked(fs.writeFileSync).mockImplementation();
      jest.mocked(fs.readFileSync).mockReturnValue(mockOutput);
      jest.mocked(fs.unlinkSync).mockImplementation();
      (PythonShell.run as jest.Mock).mockImplementation((_, __, callback) => callback(null));

      await expect(pythonUtils.runPython('testScript.py', 'testMethod', ['arg1'], { logLevel: 'INFO' })).rejects.toThrow(
        'The Python script `call_api` function must return a dict with an `output`',
      );
    });

    it('should handle invalid JSON in the output file', async () => {
      jest.mocked(fs.writeFileSync).mockImplementation();
      jest.mocked(fs.readFileSync).mockReturnValue('Invalid JSON');
      jest.mocked(fs.unlinkSync).mockImplementation();
      (PythonShell.run as jest.Mock).mockImplementation((_, __, callback) => callback(null));

      await expect(pythonUtils.runPython('testScript.py', 'testMethod', ['arg1'], { logLevel: 'INFO' })).rejects.toThrow(
        'Invalid JSON:',
      );
    });

    it('should log and throw an error with stack trace when Python script execution fails', async () => {
      const mockError = new Error('Test Error');
      mockError.stack = '--- Python Traceback ---\nError details';

      (PythonShell.run as jest.Mock).mockImplementation((_, __, callback) => callback(mockError));

      await expect(pythonUtils.runPython('testScript.py', 'testMethod', ['arg1'], { logLevel: 'INFO' })).rejects.toThrow(
        'Error running Python script: Test Error\nStack Trace: Python Traceback: \nError details',
      );

      expect(logger.error).toHaveBeenCalledWith(
        'Error running Python script: Test Error\nStack Trace: Python Traceback: \nError details',
      );
    });

    it('should handle error without stack trace', async () => {
      const mockError = new Error('Test Error Without Stack');
      mockError.stack = undefined;

      (PythonShell.run as jest.Mock).mockImplementation((_, __, callback) => callback(mockError));

      await expect(pythonUtils.runPython('testScript.py', 'testMethod', ['arg1'], { logLevel: 'INFO' })).rejects.toThrow(
        'Error running Python script: Test Error Without Stack\nStack Trace: No Python traceback available',
      );

      expect(logger.error).toHaveBeenCalledWith(
        'Error running Python script: Test Error Without Stack\nStack Trace: No Python traceback available',
      );
    });

    it('should log an error when unable to remove temporary files', async () => {
      const mockOutput = JSON.stringify({ type: 'final_result', data: 'test result' });

      jest.mocked(fs.writeFileSync).mockImplementation();
      jest.mocked(fs.readFileSync).mockReturnValue(mockOutput);
      jest.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error('Unable to delete file');
      });
      (PythonShell.run as jest.Mock).mockImplementation((_, __, callback) => callback(null));

      await pythonUtils.runPython('testScript.py', 'testMethod', ['arg1'], { logLevel: 'INFO' });

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error removing'));
    });
  });
});
