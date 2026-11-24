import asyncio

import pytest
from fastapi import HTTPException

from app.core import upload


class FakeRequest:
    def __init__(self, chunks, headers=None):
        self.headers = headers or {}
        self.chunks = chunks
        self.served = 0

    async def stream(self):
        for chunk in self.chunks:
            self.served += 1
            yield chunk


def read(request, limit):
    return asyncio.run(upload.read_limited(request, limit, "too big"))


def test_a_body_within_the_limit_is_joined_in_order():
    assert read(FakeRequest([b"ab", b"", b"cd", b"e"]), 5) == b"abcde"


def test_an_empty_body_reads_as_empty():
    assert read(FakeRequest([]), 0) == b""


def test_a_declared_length_over_the_limit_is_refused_before_reading():
    request = FakeRequest([b"x" * 10], {"content-length": "10"})
    with pytest.raises(HTTPException) as refused:
        read(request, 9)
    assert refused.value.status_code == 413
    assert refused.value.detail == "too big"
    assert request.served == 0


def test_a_declared_length_at_the_limit_is_read():
    assert read(FakeRequest([b"x" * 10], {"content-length": "10"}), 10) == b"x" * 10


def test_a_body_that_lies_about_its_length_is_cut_off_at_the_limit():
    request = FakeRequest([b"xxxx", b"xxxx", b"xxxx", b"xxxx"], {"content-length": "2"})
    with pytest.raises(HTTPException) as refused:
        read(request, 6)
    assert refused.value.status_code == 413
    assert request.served == 2


def test_a_body_with_no_or_a_malformed_length_is_still_measured():
    for headers in ({}, {"content-length": "abc"}, {"content-length": "-1"}):
        with pytest.raises(HTTPException):
            read(FakeRequest([b"xxx", b"xxx"], headers), 5)
        assert read(FakeRequest([b"xxx", b"xx"], headers), 5) == b"xxxxx"
