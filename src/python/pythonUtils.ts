import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Options as PythonShellOptions } from 'python-shell';
import { PythonShell } from 'python-shell';
import { getEnvString } from '../envars';
import logger from '../logger';
import { safeJsonStringify } from '../util/json';
import { execAsync } from './execAsync';

export const state: { cachedPythonPath: string | null } = { cachedPythonPath: null };

/**
 * Attempts to validate a Python executable path.
 * @param path - The path to the Python executable to test.
 * @returns The validated path if successful, or null if invalid.
 */
export async function tryPath(path: string): Promise<string | null> {
  try {
    const result = await Promise.race([
      execAsync(`${path} --version`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Command timed out')), 250),
      ),
    ]);
    const versionOutput = (result as { stdout: string }).stdout.trim();
    if (versionOutput.startsWith('Python')) {
      return path;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validates and caches the Python executable path.
 *
 * @param pythonPath - Path to the Python executable.
 * @param isExplicit - If true, only tries the provided path.
 * @returns Validated Python executable path.
 * @throws {Error} If no valid Python executable is found.
 */
export async function validatePythonPath(pythonPath: string, isExplicit: boolean): Promise<string> {
  if (state.cachedPythonPath) {
    return state.cachedPythonPath;
  }

  const primaryPath = await tryPath(pythonPath);
  if (primaryPath) {
    state.cachedPythonPath = primaryPath;
    return primaryPath;
  }

  if (isExplicit) {
    throw new Error(
      `Python 3 not found. Tried "${pythonPath}" ` +
        `Please ensure Python 3 is installed and set the PROMPTFOO_PYTHON environment variable ` +
        `to your Python 3 executable path (e.g., '${process.platform === 'win32' ? 'C:\\Python39\\python.exe' : '/usr/bin/python3'}').`,
    );
  }
  const alternativePath = process.platform === 'win32' ? 'py -3' : 'python3';
  const secondaryPath = await tryPath(alternativePath);
  if (secondaryPath) {
    state.cachedPythonPath = secondaryPath;
    return secondaryPath;
  }

  throw new Error(
    `Python 3 not found. Tried "${pythonPath}" and "${alternativePath}". ` +
      `Please ensure Python 3 is installed and set the PROMPTFOO_PYTHON environment variable ` +
      `to your Python 3 executable path (e.g., '${process.platform === 'win32' ? 'C:\\Python39\\python.exe' : '/usr/bin/python3'}').`,
  );
}

const handlePythonLog = (message: string) => {
  const [level, ...msgParts] = message.split(':');
  const msg = msgParts.join(':');
  switch (level) {
    case 'DEBUG':
      logger.debug(`Python: ${msg}`);
      break;
    case 'INFO':
      logger.info(`Python: ${msg}`);
      break;
    case 'WARNING':
      logger.warn(`Python: ${msg}`);
      break;
    case 'ERROR':
    case 'CRITICAL':
      logger.error(`Python ${level}: ${msg}`);
      break;
    default:
      logger.info(`Python: ${message}`);
  }
};

const safeDelete = (file: string) => {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error(`Error removing ${file}: ${error}`);
    }
  }
};

/**
 * Runs a Python script with the specified method and arguments.
 *
 * @param scriptPath - The path to the Python script to run.
 * @param method - The name of the method to call in the Python script.
 * @param args - An array of arguments to pass to the Python script.
 * @param options - Optional settings for running the Python script.
 * @param options.pythonExecutable - Optional path to the Python executable.
 * @returns A promise that resolves to the output of the Python script.
 * @throws An error if there's an issue running the Python script or parsing its output.
 */
export async function runPython(
  scriptPath: string,
  method: string,
  args: (string | object | undefined)[],
  options: { pythonExecutable?: string; logLevel?: string } = {},
): Promise<string | object> {
  const absPath = path.resolve(scriptPath);
  const tempJsonPath = path.join(
    os.tmpdir(),
    `promptfoo-python-input-json-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  const outputPath = path.join(
    os.tmpdir(),
    `promptfoo-python-output-json-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  const customPath = options.pythonExecutable || getEnvString('PROMPTFOO_PYTHON');
  const pythonPath = customPath || 'python';
  const logLevel = options.logLevel || 'INFO';

  await validatePythonPath(pythonPath, typeof customPath === 'string');

  const pythonOptions: PythonShellOptions = {
    mode: 'text',
    pythonPath,
    scriptPath: __dirname,
    args: [absPath, method, logLevel, tempJsonPath, outputPath],
  };

  try {
    fs.writeFileSync(tempJsonPath, safeJsonStringify(args), 'utf-8');
    logger.debug(`Running Python wrapper with args: ${safeJsonStringify(args)}`);

    return new Promise((resolve, reject) => {
      const pyshell = new PythonShell('wrapper.py', pythonOptions);
      pyshell.on('message', handlePythonLog);
      pyshell.end(async (err) => {
        if (err) {
          reject(err);
          return;
        }

        try {
          // Wait for a short time to ensure the file is written
          await new Promise((resolve) => setTimeout(resolve, 100));

          const data = fs.readFileSync(outputPath, 'utf-8');
          const result = JSON.parse(data);
          if (result?.type === 'final_result') {
            resolve(result.data);
          } else {
            reject(
              new Error(
                'The Python script `call_api` function must return a dict with an `output`',
              ),
            );
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes('ENOENT')) {
            reject(
              new Error(
                `Output file not found: ${outputPath}. This may be due to the Python script not completing successfully.`,
              ),
            );
          } else {
            reject(new Error(`Error reading or parsing output: ${(error as Error).message}`));
          }
        }
      });
    });
  } catch (error) {
    logger.error(
      `Error running Python script: ${(error as Error).message}\nStack Trace: ${
        (error as Error).stack || 'No stack trace available'
      }`,
    );
    throw error;
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    Promise.all([tempJsonPath, outputPath].map(safeDelete));
  }
}
