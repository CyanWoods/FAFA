import json, os, sys, tempfile, pytest
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import fafa.db as db
import app as flask_app

@pytest.fixture
def client(tmp_path):
    db._DB_PATH = tmp_path / "fafa.db"
    db.init_db(tmp_path)
    flask_app.app.config["TESTING"] = True
    with flask_app.app.test_client() as c:
        yield c

def _seed_tag(name="blue", color="#0000ff"):
    return db.create_tag(name, color)

def test_batch_add_tags(client):
    tag = _seed_tag()
    payload = {"filenames": ["a.fit", "b.fit"], "add_tag_ids": [tag["id"]], "remove_tag_ids": []}
    r = client.post("/api/meta/batch/tags", json=payload)
    assert r.status_code == 200
    data = r.get_json()
    assert data["ok"] is True
    assert data["updated"] == 2
    assert any(t["id"] == tag["id"] for t in db.get_activity_meta("a.fit")["tags"])
    assert any(t["id"] == tag["id"] for t in db.get_activity_meta("b.fit")["tags"])

def test_batch_remove_tags(client):
    tag = _seed_tag("red", "#ff0000")
    db.save_tags("a.fit", [tag["id"]])
    payload = {"filenames": ["a.fit"], "add_tag_ids": [], "remove_tag_ids": [tag["id"]]}
    r = client.post("/api/meta/batch/tags", json=payload)
    assert r.status_code == 200
    assert r.get_json()["updated"] == 1
    assert db.get_activity_meta("a.fit")["tags"] == []

def test_batch_conflict_returns_400(client):
    tag = _seed_tag()
    payload = {"filenames": ["a.fit"], "add_tag_ids": [tag["id"]], "remove_tag_ids": [tag["id"]]}
    r = client.post("/api/meta/batch/tags", json=payload)
    assert r.status_code == 400

def test_batch_both_empty_noop(client):
    payload = {"filenames": ["a.fit"], "add_tag_ids": [], "remove_tag_ids": []}
    r = client.post("/api/meta/batch/tags", json=payload)
    assert r.status_code == 200
    assert r.get_json() == {"ok": True, "updated": 0}

def test_batch_skips_non_fit(client):
    tag = _seed_tag()
    payload = {"filenames": ["a.fit", "bad.csv"], "add_tag_ids": [tag["id"]], "remove_tag_ids": []}
    r = client.post("/api/meta/batch/tags", json=payload)
    assert r.status_code == 200
    assert r.get_json()["updated"] == 1
