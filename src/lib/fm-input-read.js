// Komplet danych jest konieczny: błąd lub obcięta strona odpowiedzi nie może
// wyglądać jak milczenie kupca i przywracać odrzuconej pary do algorytmu.
export async function readAllFmInputRows(makeQuery) {
  const rows = [];
  let expectedCount = null;
  do {
    const { data, error, count } = await makeQuery()
      .range(rows.length, rows.length + 499)
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) throw error;
    if (!Array.isArray(data) || !Number.isInteger(count) || count < 0) {
      throw new Error("FM_INPUTS_INCOMPLETE");
    }
    if (expectedCount !== null && count !== expectedCount) throw new Error("FM_INPUTS_CHANGED");
    expectedCount = count;
    if (data.length === 0 && rows.length < count) throw new Error("FM_INPUTS_INCOMPLETE");
    rows.push(...data);
    if (rows.length > count) throw new Error("FM_INPUTS_INCOMPLETE");
  } while (rows.length < expectedCount);
  return rows;
}
