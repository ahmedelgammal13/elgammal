"""Tests for the main module."""

from src.main import greet, add, is_even


def test_greet():
    assert greet("Ahmed") == "Hello, Ahmed! Welcome to elgammal."
    assert greet("World") == "Hello, World! Welcome to elgammal."


def test_add():
    assert add(2, 3) == 5
    assert add(-1, 1) == 0
    assert add(0, 0) == 0


def test_is_even():
    assert is_even(4) is True
    assert is_even(3) is False
    assert is_even(0) is True
