import os
import sys
import tempfile
from pathlib import Path

# Isolate every test run: its own data dir/DB, inline queue, and no Groq key.
_tmp = tempfile.mkdtemp(prefix="tonelens-test-")
os.environ["TONELENS_DATA_DIR"] = _tmp
os.environ["TONELENS_QUEUE"] = "inline"
os.environ["TONELENS_SERVE_FRONTEND"] = "false"
os.environ["GROQ_API_KEY"] = ""

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
