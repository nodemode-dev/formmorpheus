import io
import json
import zipfile

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def movie_bytes(movie_id="m1", name="Film", poster=None, extra=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("movie.json", json.dumps({"id": movie_id, "name": name, "frames": 3}))
        if poster is not None:
            z.writestr("poster.png", poster)
        for k, v in (extra or {}).items():
            z.writestr(k, v)
    return buf.getvalue()


def save(client, name, **kw):
    r = client.put(f"/api/library/{name}", content=movie_bytes(**kw))
    assert r.status_code == 200, r.text
    return r.json()


def names(client):
    return sorted(i["name"] for i in client.get("/api/library").json()["items"])


def read_json(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return json.loads(z.read("movie.json"))
