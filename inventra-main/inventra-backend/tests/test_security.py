"""Browser-borne attacks on a local API: cross-site writes (CSRF) and DNS rebinding."""
import pytest
from fastapi.testclient import TestClient

from inventra.api.main import app

EVIL = {"Origin": "https://evil.example"}


@pytest.fixture(scope="module")
def c():
    with TestClient(app) as client:
        client.post("/reset")
        yield client


def test_cross_site_writes_are_refused(c):
    # a form upload and an empty POST need no CORS preflight, so CORS alone does not stop them
    csv = b"location,cost_per_unit_day_aed\nDubai,0.5\n"
    r = c.post("/data/upload/holding_costs", headers=EVIL, files={"file": ("holding_costs.csv", csv, "text/csv")})
    assert r.status_code == 403
    assert c.post("/reset", headers=EVIL).status_code == 403
    assert c.post("/inbox/events/seen", headers={"Origin": "null"}).status_code == 403  # sandboxed iframe
    assert c.get("/plan", headers=EVIL).status_code == 200                              # reads stay CORS-governed


def test_the_frontend_and_the_docs_page_may_write(c):
    assert c.post("/inbox/events/seen", headers={"Origin": "http://localhost:3000"}).status_code == 200
    assert c.post("/inbox/events/seen", headers={"Origin": "http://testserver"}).status_code == 200  # same origin (/docs)
    assert c.post("/inbox/events/seen").status_code == 200                                         # not a browser


def test_unknown_host_is_refused(c):
    assert c.get("/plan", headers={"Host": "attacker.example"}).status_code == 400
    assert c.get("/settings/mode", headers={"Host": "localhost:8000"}).status_code == 200


def test_oversized_upload_refused_before_parsing(c):
    big = b"x" * (6 * 1024 * 1024)
    r = c.post("/data/upload/holding_costs", files={"file": ("holding_costs.csv", big, "text/csv")})
    assert r.status_code == 413
