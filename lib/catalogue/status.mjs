/** PostgreSQL converts an empty typed row to an object of nulls, not JSON null. */
export function normaliseCatalogueStatus(state) {
  return {
    ...state,
    batch:
      typeof state?.batch?.id === "string" && state.batch.id
        ? state.batch
        : null,
  };
}
