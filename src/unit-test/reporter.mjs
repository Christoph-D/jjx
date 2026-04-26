export default async function* reporter(source) {
  let pass = 0;
  let fail = 0;
  const failures = [];

  for await (const event of source) {
    const { type, data } = event;

    if (type === "test:pass") {
      if (data.details?.type !== "suite") {
        pass++;
      }
    } else if (type === "test:fail") {
      if (data.details?.type !== "suite") {
        fail++;
        failures.push(data);
      }
    }
  }

  if (failures.length > 0) {
    yield "Failed tests:\n\n";
    for (const f of failures) {
      yield `  \u2718 ${f.name}\n`;
      const stack = f.details?.error?.cause?.stack || f.details?.error?.stack;
      if (stack) {
        let foundFile = false;
        for (const line of stack.split("\n")) {
          if (foundFile && !line.includes(f.file)) {
            yield `        ...\n`;
            break;
          }
          if (line.includes(f.file)) {
            foundFile = true;
          }
          yield `    ${line}\n`;
        }
      }
      yield "\n";
    }
  }
  if (fail === 0) {
    yield `All ${pass} unit tests passed!\n`;
  } else {
    yield `Passed: ${pass}\nFailed: ${fail}\n`;
  }
}
