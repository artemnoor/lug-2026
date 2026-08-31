from apps.api.app.observability import Metrics


def test_route_histogram_uses_template_label_and_preserves_global_histogram():
    metrics = Metrics("test")
    metrics.observe("http_request_duration", 12)
    metrics.observe_route("http_request_duration", "/api/users/{user_id}", 12)
    output = metrics.prometheus()
    assert 'lug_http_request_duration_count{service="test"} 1' in output
    assert 'route="/api/users/{user_id}"' in output
    assert (
        'lug_http_request_duration_count{route="/api/users/{user_id}",service="test"} 1'
        in output
    )
