"""Keep native Python extensions loadable from relocatable Windows runtime paths."""
import os
import sys


def _extended_path(path):
    if not path or not os.path.isabs(path) or path.startswith("\\\\?\\"):
        return path
    path = os.path.abspath(path)
    if path.startswith("\\\\"):
        return "\\\\?\\UNC\\" + path[2:]
    return "\\\\?\\" + path


if sys.platform == "win32":
    # LoadLibraryExW does not automatically extend long paths when importing .pyd files.
    # Compute prefixes at startup so neither the payload nor its manifest embeds its build path.
    sys.path[:] = [_extended_path(path) for path in sys.path]
