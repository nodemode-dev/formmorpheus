import pytest

from app.core import config


@pytest.mark.parametrize("path", ["/api/health", "/api/capabilities", "/api/trash", "/api/recovery"])
def test_the_engine_mounts_each_router_under_its_prefix(client, path):
    assert client.get(path).status_code == 200


def test_an_unmounted_api_path_is_not_found(client):
    assert client.get("/api/no-such-router-here").status_code == 404


def test_health_reports_the_app_and_its_configured_version(client):
    body = client.get("/api/health").json()
    assert body == {"ok": True, "app": config.APP_NAME, "version": config.VERSION}


def test_capabilities_report_the_data_folder_in_use(client, data_dir):
    body = client.get("/api/capabilities").json()
    assert body["projectExt"] == config.PROJECT_EXT
    assert body["dataDir"] == str(config.data_dir())
