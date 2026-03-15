from base.Base import Base
from module.Config import Config
from module.Engine.TaskRequester import TaskRequester


def test_generate_google_args_maps_system_into_system_instruction() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.GOOGLE,
            "api_key": "dummy",
            "api_url": "https://example.invalid",
            "model_id": "gemini-test",
        },
    )

    args = requester.generate_google_args(
        [
            {"role": "system", "content": "SYS-1"},
            {"role": "system", "content": "SYS-2"},
            {"role": "user", "content": "USER"},
        ],
        {},
    )

    assert args["contents"] == ["USER"]
    assert args["config"].system_instruction == "SYS-1\n\nSYS-2"


def test_generate_anthropic_args_maps_top_level_system_and_filters_messages() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.ANTHROPIC,
            "api_key": "dummy",
            "api_url": "https://example.invalid",
            "model_id": "claude-test",
        },
    )

    args = requester.generate_anthropic_args(
        [
            {"role": "system", "content": "SYS-1"},
            {"role": "system", "content": "SYS-2"},
            {"role": "user", "content": "USER"},
            {"role": "assistant", "content": "ASSIST"},
        ],
        {},
    )

    assert args["system"] == "SYS-1\n\nSYS-2"
    assert all(msg.get("role") != "system" for msg in args["messages"])
    assert any(
        msg.get("role") == "user" and msg.get("content") == "USER"
        for msg in args["messages"]
    )
