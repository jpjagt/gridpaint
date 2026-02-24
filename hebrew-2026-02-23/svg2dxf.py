import os
import svgpathtools
from ezdxf import new
from ezdxf import units


POINTS_PER_MM = 10

input_folder = "./svgs"
output_folder = "./dxfs"
os.makedirs(output_folder, exist_ok=True)

for filename in os.listdir(input_folder):
    if filename.lower().endswith(".svg"):
        svg_path = os.path.join(input_folder, filename)
        dxf_path = os.path.join(output_folder, os.path.splitext(filename)[0] + ".dxf")

        # Parse SVG + attributes (includes width/height/viewBox)
        paths, attributes, svg_attributes = svgpathtools.svg2paths2(svg_path)

        # Extract SVG dimensions (mm -> user units scaling)
        width = svg_attributes.get("width", "21.6mm")
        height = svg_attributes.get("height", "37.8mm")
        viewbox = svg_attributes.get("viewBox", "-40 -30 12 21").split()

        # Convert mm to float if specified
        if width.endswith("mm"):
            svg_width_mm = float(width[:-2])
        else:
            svg_width_mm = float(width)

        if height.endswith("mm"):
            svg_height_mm = float(height[:-2])
        else:
            svg_height_mm = float(height)

        print(f"SVG {filename}: {svg_width_mm:.1f}×{svg_height_mm:.1f}mm")

        # Create DXF with MILLIMETER units
        doc = new("R2010")
        doc.units = units.MM
        doc.header["$INSUNITS"] = 4  # Explicitly millimeters

        msp = doc.modelspace()

        for path_idx, path in enumerate(paths):
            # Calculate actual path length in SVG units
            path_length = path.length()

            # Scale to mm: viewBox width (12 units) = svg_width_mm
            scale_factor = svg_width_mm / float(viewbox[2])
            path_length_mm = path_length * scale_factor

            # Adaptive sampling: points_per_mm * length_mm
            num_samples = max(2, int(path_length_mm * POINTS_PER_MM))

            polyline_points = []
            for i in range(num_samples + 1):
                t = i / num_samples
                point = path.point(t)
                # Scale coordinates from SVG units to mm
                x = point.real * scale_factor
                y = point.imag * scale_factor
                polyline_points.append((float(x), float(y)))

            # Remove duplicates and create LWPOLYLINE
            unique_points = []
            for p in polyline_points:
                if (
                    not unique_points
                    or abs(p[0] - unique_points[-1][0]) > 0.01
                    or abs(p[1] - unique_points[-1][1]) > 0.01
                ):
                    unique_points.append(p)

            if len(unique_points) > 1:
                msp.add_lwpolyline(unique_points, format="xy")
                print(
                    f"  Path {path_idx}: {path_length_mm:.1f}mm → {len(unique_points)} points"
                )

        doc.saveas(dxf_path)
        print(f"✓ Converted: {filename}")
