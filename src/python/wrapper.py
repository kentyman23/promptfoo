import asyncio
import contextlib
import importlib.util
import io
import json
import logging
import os
import sys


class LoggingIO(io.StringIO):
    def __init__(self, logger, level):
        super().__init__()
        self.logger = logger
        self.level = level

    def write(self, msg):
        if msg.strip():
            self.logger.log(self.level, msg.strip())

    def flush(self):
        pass


def setup_logging(log_level):
    logger = logging.getLogger("promptfoo")
    logger.setLevel(log_level)
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter("%(levelname)s:%(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    return logger


@contextlib.contextmanager
def redirect_stdout_stderr(logger):
    stdout_logger = LoggingIO(logger, logging.INFO)
    stderr_logger = LoggingIO(logger, logging.ERROR)
    with contextlib.redirect_stdout(stdout_logger), contextlib.redirect_stderr(
        stderr_logger
    ):
        yield


def import_module(script_path):
    script_dir = os.path.dirname(os.path.abspath(script_path))
    module_name = os.path.basename(script_path).rsplit(".", 1)[0]
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)

    spec = importlib.util.spec_from_file_location(module_name, script_path)
    script_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script_module)
    return script_module


def call_method(script_path, method_name, log_level, *args):
    logger = setup_logging(log_level)
    logger.info(f"Importing module from {script_path} ...")

    script_module = import_module(script_path)
    method_to_call = getattr(script_module, method_name)

    with redirect_stdout_stderr(logger):
        if asyncio.iscoroutinefunction(method_to_call):
            result = asyncio.run(method_to_call(*args))
        else:
            result = method_to_call(*args)

    return result


if __name__ == "__main__":
    script_path, method_name, log_level, json_path, output_path = sys.argv[1:6]

    with open(json_path, "r", encoding="utf-8") as fp:
        data = json.load(fp)

    log_level = getattr(logging, log_level.upper())
    result = call_method(script_path, method_name, log_level, *data)

    with open(output_path, "w", encoding="utf-8") as fp:
        json.dump({"type": "final_result", "data": result}, fp)
