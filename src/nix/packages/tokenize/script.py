import sys

from tokenizers import Tokenizer


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: tokenize <corpus> [tokenizer.json]", file=sys.stderr)
        return 1

    corpus, tokenizer = sys.argv[1], sys.argv[2]
    tokens = Tokenizer.from_file(tokenizer).encode(open(corpus).read()).ids
    print(len(tokens))
    return 0


if __name__ == "__main__":
    sys.exit(main())
