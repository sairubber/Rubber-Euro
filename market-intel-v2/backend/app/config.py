import os
from pathlib import Path

from dotenv import load_dotenv

# override=True: this app's own .env should win over anything already set in
# the parent shell/environment (e.g. by a coding assistant's own tooling).
load_dotenv(override=True)

# Anchor the default SQLite file to the backend directory, not the process
# cwd — launching uvicorn with --app-dir from anywhere else silently created
# a second, empty database and abandoned the archive.
_BACKEND_DIR = Path(__file__).resolve().parent.parent

# The scraper runs continuously — this is just the gap between passes, not a
# pause. Short by design so the wall never goes stale for long; each pass is
# cheap (real HTTP calls, no AI cost) so a short interval is safe.
REFRESH_MINUTES = int(os.environ.get("REFRESH_MINUTES", "10"))
CLIMATE_REFRESH_HOURS = int(os.environ.get("CLIMATE_REFRESH_HOURS", "3"))
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{(_BACKEND_DIR / 'market_intel.db').as_posix()}")
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

# Optional — NewsAPI.org free tier, used as a supplementary source alongside
# the Google News RSS scraper (which needs no key at all). Leave blank to
# skip it entirely; nothing breaks.
NEWS_API_KEY = os.environ.get("NEWS_API_KEY", "")

# Optional — MyMemory's free translation API works anonymously (5,000
# words/day) but raises the quota to 50,000/day if you pass a registered
# email. Leave blank to use the anonymous tier.
TRANSLATE_EMAIL = os.environ.get("TRANSLATE_EMAIL", "")

# Optional — aisstream.io free API key (user-registered). Powers the Vessel
# Watch live AIS feed; leave blank and the tab reports itself unconfigured
# instead of showing anything fake.
AISSTREAM_KEY = os.environ.get("AISSTREAM_KEY", "")

IST = "Asia/Kolkata"
