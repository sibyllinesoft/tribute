from tribute_core import UsageTracker, enrich_response, wrap_iterable


def test_usage_tracker_body_count():
    tracker = UsageTracker()
    tracker.add_chunk(b"hello")
    tracker.add_chunk(b"world")
    tracker.set_usage({"tokens": 5})
    tracker.set_final_price(0.42)

    report = tracker.build()
    assert report.response_bytes == 10
    assert report.usage["tokens"] == 5
    assert report.final_price == 0.42


def test_enrich_response_helper():
    body, report = enrich_response(body=b"payload", usage={"foo": "bar"}, final_price=1.2)
    assert body == b"payload"
    assert report.usage["foo"] == "bar"
    assert report.response_bytes == len(body)
    assert report.final_price == 1.2


def test_wrap_iterable_counts_chunks():
    tracker = UsageTracker()
    wrapped = wrap_iterable([b"ab", b"cd"], tracker=tracker)
    collected = b"".join(list(wrapped))
    assert collected == b"abcd"
    assert tracker.build().response_bytes == 4
