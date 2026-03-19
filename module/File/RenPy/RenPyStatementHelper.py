from module.File.RenPy.RenPyAst import StatementNode


def find_dialogue_string_group(
    stmt: StatementNode, name_index: int | None = None
) -> list[int]:
    if not stmt.literals:
        return []

    start_col = get_dialogue_start_col(stmt, name_index)
    if start_col is None:
        return []

    start_index = find_first_string_after_col(stmt, start_col)
    if start_index is None:
        return []

    # 这里只把中间全是空白的连续字符串算作正文，避免把尾部参数里的字符串误当成可翻译文本。
    indices = [start_index]
    for idx in range(start_index + 1, len(stmt.literals)):
        prev_lit = stmt.literals[idx - 1]
        next_lit = stmt.literals[idx]
        between = stmt.code[prev_lit.end_col : next_lit.start_col]
        if between.strip() != "":
            break
        indices.append(idx)

    return indices


def find_first_string_after_col(stmt: StatementNode, start_col: int) -> int | None:
    for idx, lit in enumerate(stmt.literals):
        if lit.start_col >= start_col:
            return idx

    return None


def find_character_name_lit_index(stmt: StatementNode) -> int | None:
    code = stmt.code.lstrip()
    if not code.startswith("Character("):
        return None

    open_pos = stmt.code.find("(")
    if open_pos < 0:
        return None

    close_pos = find_matching_paren(stmt, open_pos)
    if close_pos is None:
        return None

    for index, lit in enumerate(stmt.literals):
        if open_pos < lit.start_col < close_pos:
            return index

    return None


def find_matching_paren(stmt: StatementNode, open_pos: int) -> int | None:
    literal_ranges = [(lit.start_col, lit.end_col) for lit in stmt.literals]
    range_index = 0
    depth = 0
    code_index = open_pos

    while code_index < len(stmt.code):
        if range_index < len(literal_ranges):
            literal_start, literal_end = literal_ranges[range_index]
            if code_index == literal_start:
                code_index = literal_end
                range_index += 1
                continue

        char = stmt.code[code_index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return code_index

        code_index += 1

    return None


def get_dialogue_start_col(
    stmt: StatementNode, name_index: int | None = None
) -> int | None:
    if name_index is None:
        return 0

    open_pos = stmt.code.find("(")
    if open_pos < 0:
        return None

    close_pos = find_matching_paren(stmt, open_pos)
    if close_pos is None:
        return None

    # Character(...) 里的名字是角色声明，不该和后面的正文字符串混在一起。
    return close_pos + 1
