"""Main module for the elgammal project."""


def greet(name: str) -> str:
    """Return a greeting message."""
    return f"Hello, {name}! Welcome to elgammal."


def add(a: int, b: int) -> int:
    """Return the sum of two numbers."""
    return a + b


def is_even(n: int) -> bool:
    """Check if a number is even."""
    return n % 2 == 0


if __name__ == "__main__":
    print(greet("World"))
    print(f"2 + 3 = {add(2, 3)}")
    print(f"4 is even: {is_even(4)}")
