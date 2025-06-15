export const createToolCode = (code) => `
import sys

${code}

if __name__ == "__main__":
    params_str = sys.argv[1]
    params = json.loads(params_str)

    result = block_handler(params)
    print(result)
`;

