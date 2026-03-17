import argparse
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def build_output_lines(brand_id: str) -> list[str]:
    """统一导出工作流真正消费的品牌元信息，避免保留未使用字段。"""

    from base.BaseBrand import BaseBrand

    brand = BaseBrand.get(brand_id)
    build_names = brand.build_names
    return [
        f"brand_id={brand.brand_id}",
        f"app_name={brand.app_name}",
        f"repo_url={brand.repo_url}",
        f"release_api_url={brand.release_api_url}",
        f"release_url={brand.release_url}",
        f"user_agent_name={brand.user_agent_name}",
        f"project_display_name={brand.project_display_name}",
        f"data_dir_name={brand.data_dir_name}",
        f"dist_dir_name={build_names.dist_dir_name}",
        f"macos_bundle_name={build_names.macos_bundle_name}",
        f"linux_desktop_name={build_names.linux_desktop_name}",
        f"linux_icon_name={build_names.linux_icon_name}",
        f"bundle_identifier={build_names.bundle_identifier}",
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--brand", type=str, required=True, choices=["lg", "kg"])
    args = parser.parse_args()

    for line in build_output_lines(args.brand):
        print(line)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
