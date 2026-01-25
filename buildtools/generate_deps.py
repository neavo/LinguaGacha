import tomllib

with open("pyproject.toml", "rb") as reader:
    data = tomllib.load(reader)
    dependencies = data.get("project", {}).get("dependencies", [])

with open("requirements.txt", "w", encoding="utf-8") as writer:
    for dep in dependencies:
        writer.write(dep + "\n")
