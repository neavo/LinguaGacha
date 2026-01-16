import tomli

with open("pyproject.toml", "rb") as reader:
    data = tomli.load(reader)
    dependencies = data.get("project", {}).get("dependencies", [])

with open("requirements.txt", "w", encoding="utf-8") as writer:
    for dep in dependencies:
        writer.write(dep + "\n")
