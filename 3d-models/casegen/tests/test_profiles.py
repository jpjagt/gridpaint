import numpy as np

from profiles import f_axis, f_diag, quarter_weight, smoothstep


def test_f_axis_endpoints_and_flat_ends():
    a = 2.5
    assert f_axis(0.0, a) == 0.0
    assert f_axis(1.0, a) == 1.0
    assert np.isclose(f_axis(0.5, a), 0.5)
    # sigmoid: zero slope at both ends (finite difference)
    h = 1e-4
    assert (f_axis(h, a) - f_axis(0.0, a)) / h < 0.01
    assert (f_axis(1.0, a) - f_axis(1.0 - h, a)) / h < 0.01


def test_f_diag_steep_start_flat_end():
    b = 2.2
    assert f_diag(0.0, b) == 0.0
    assert f_diag(1.0, b) == 1.0
    h = 1e-4
    # slope at 0 is ~b, slope at 1 is ~0
    assert np.isclose((f_diag(h, b) - 0.0) / h, b, rtol=0.01)
    assert (f_diag(1.0, b) - f_diag(1.0 - h, b)) / h < 0.01


def test_diagonal_above_axis_mid_slope():
    t = 0.35
    assert f_diag(t, 2.2) > f_axis(t, 2.5)


def test_quarter_weight():
    k = 1.5
    assert np.isclose(quarter_weight(0.0, k), 1.0)
    assert np.isclose(quarter_weight(np.pi / 2, k), 1.0)
    assert np.isclose(quarter_weight(np.pi / 4, k), 0.0, atol=1e-9)


def test_smoothstep():
    assert smoothstep(-1.0) == 0.0
    assert smoothstep(2.0) == 1.0
    assert np.isclose(smoothstep(0.5), 0.5)
