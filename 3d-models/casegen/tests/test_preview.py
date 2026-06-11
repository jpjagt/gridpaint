from meshing import generate_meshes
from preview import render


def test_render_writes_files(default_params, plan, surf, tmp_path):
    body, lid = generate_meshes(default_params, plan, surf)
    render(default_params, plan, surf, body, lid, tmp_path)
    assert (tmp_path / "preview.png").exists()
    assert (tmp_path / "profile-sections.png").exists()
