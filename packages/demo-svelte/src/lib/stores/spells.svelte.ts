class PaginationStore {
  after = $state<string | null>(null);
  before = $state<string | null>(null);
  limit = $state(10);
  filter = $state({ query: "", sort: "CREATE_DATE_DESC" });

  setQuery(value: string) {
    this.filter.query = value ?? "";
    this.resetPagination();
  }

  setSort(value: string) {
    this.filter.sort = value ?? "CREATE_DATE_DESC";
    this.resetPagination();
  }

  setAfter(value: string | null) {
    this.after = value ?? null;
    this.before = null;
  }

  setBefore(value: string | null) {
    this.before = value ?? null;
    this.after = null;
  }

  setLimit(value: number) {
    this.limit = value;
  }

  resetPagination() {
    this.after = null;
    this.before = null;
  }

  reset() {
    this.resetPagination();
    this.filter = { query: "", sort: "CREATE_DATE_DESC" };
  }
}

class ActivityStore {
  isFetching = $state(false);
}

let paginationInstance: PaginationStore | null = null;
let activityInstance: ActivityStore | null = null;

export function getSpellsPagination(): PaginationStore {
  if (!paginationInstance) {
    paginationInstance = new PaginationStore();
  }

  return paginationInstance;
}

export function getSpellsActivity(): ActivityStore {
  if (!activityInstance) {
    activityInstance = new ActivityStore();
  }

  return activityInstance;
}
