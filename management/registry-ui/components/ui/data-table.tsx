import React, { useEffect, useRef, useState } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel,
  flexRender,
  type ColumnDef, type SortingState, type VisibilityState, type RowSelectionState,
  type TableOptions, type Header, type Row, type RowData,
} from '@tanstack/react-table';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ArrowUp, ArrowDown, ArrowUpDown, Search, Settings2,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from 'lucide-react';

// Opt-in per-column metadata. Callers mark a column with `meta.stopRowClick`
// to keep its clicks from bubbling into onRowClick (e.g. links / switches /
// menus living inside a navigable row). The '__select' and 'actions' columns
// keep stopping propagation by default for backward compatibility.
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- must mirror TanStack's ColumnMeta signature
  interface ColumnMeta<TData extends RowData, TValue> {
    /** When true, clicks inside this column's cells do not trigger onRowClick. */
    stopRowClick?: boolean;
  }
}

const DEFAULT_PAGE_SIZE = 20;

interface DataTableProps<TData> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TanStack columns hold heterogeneous cell value types
  columns: ColumnDef<TData, any>[];
  data: TData[];
  loading?: boolean;
  /** 'skeleton' preserves column widths (default); 'spinner' shows a centered spinner. */
  loadingVariant?: 'skeleton' | 'spinner';
  emptyMessage?: string;
  emptyFilteredMessage?: string;
  /** Action slot rendered under the empty state (e.g. a "Clear filters" button). */
  emptyAction?: React.ReactNode;
  /** Treat the current view as filtered (any toolbar filter active), so the filtered empty message shows even when search is blank. */
  isFiltered?: boolean;

  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Accessible label for the search field. */
  searchLabel?: string;
  /** aria-label for the search clear (×) button. */
  clearSearchLabel?: string;
  /** Show a clear (×) button in the search field. Default true. */
  searchClearable?: boolean;
  /** Debounce search onChange by this many ms. Default 250. Set 0 to disable. */
  searchDebounceMs?: number;

  enableSelection?: boolean;
  onSelectionChange?: (rows: TData[]) => void;
  /** Called when the built-in "Clear" affordance in the batch bar is used. */
  onClearSelection?: () => void;
  /** aria-label for the header "select all" checkbox. */
  selectAllLabel?: string;
  /** aria-label for per-row select checkboxes. */
  selectRowLabel?: string;
  /** Label for the batch-bar clear button. */
  clearSelectionLabel?: string;
  /** aria-label for the batch-actions region. */
  batchRegionLabel?: string;
  /** Render the "N selected" count text. Defaults to `${n} selected`. */
  renderSelectedCount?: (count: number) => React.ReactNode;

  pageSize?: number;
  /** Optional rows-per-page choices; when given (length > 1) a selector is shown. */
  pageSizeOptions?: number[];

  /**
   * Server-side pagination. When true the table does not slice `data` itself —
   * `data` is treated as the current page, and the caller drives navigation via
   * `pageIndex` / `pageCount` / `onPageChange`. Use `rowCount` for the total.
   */
  manualPagination?: boolean;
  /** Controlled current page index (0-based) when `manualPagination` is true. */
  pageIndex?: number;
  /** Total number of pages when `manualPagination` is true. */
  pageCount?: number;
  /** Total row count across all pages, for the range read-out (manual mode). */
  rowCount?: number;
  /** Called with the next 0-based page index when the user navigates (manual mode). */
  onPageChange?: (pageIndex: number) => void;
  /** Label for the rows-per-page selector. */
  rowsPerPageLabel?: string;
  /** aria-label for the pagination nav landmark. */
  paginationLabel?: string;
  firstPageLabel?: string;
  previousPageLabel?: string;
  nextPageLabel?: string;
  lastPageLabel?: string;
  /** Render the range read-out. Defaults to `${from}–${to} of ${total}`. */
  renderRangeLabel?: (info: { from: number; to: number; total: number }) => React.ReactNode;

  storageKey?: string;

  getRowId?: (row: TData) => string;
  onRowClick?: (row: TData) => void;
  /** Semantic role for clickable rows. Default 'button'. */
  rowRole?: 'button' | 'link';
  /** Accessible name for a clickable row describing its destination/action. */
  getRowAriaLabel?: (row: TData) => string;

  toolbar?: React.ReactNode;
  batchActions?: React.ReactNode;
  /** Label for the column-visibility trigger button. */
  columnsLabel?: string;
  /** Heading inside the column-visibility menu. */
  toggleColumnsLabel?: string;

  columnLabels?: Record<string, string>;
  /** Build the sort button aria-label. Defaults to `Sort by ${label}`. */
  getSortLabel?: (columnLabel: string) => string;

  /** Accessible name applied to the <table>. */
  ariaLabel?: string;
  /** Visible <caption> for the table. */
  caption?: React.ReactNode;

  defaultSorting?: SortingState;
  defaultVisibility?: VisibilityState;
}

export function DataTable<TData>({
  columns,
  data,
  loading = false,
  loadingVariant = 'skeleton',
  emptyMessage = 'No data.',
  emptyFilteredMessage,
  emptyAction,
  isFiltered = false,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  searchLabel = 'Search',
  clearSearchLabel = 'Clear search',
  searchClearable = true,
  searchDebounceMs = 250,
  enableSelection = false,
  onSelectionChange,
  onClearSelection,
  selectAllLabel = 'Select all on this page',
  selectRowLabel = 'Select row',
  clearSelectionLabel = 'Clear',
  batchRegionLabel = 'Selected rows',
  renderSelectedCount,
  pageSize = DEFAULT_PAGE_SIZE,
  pageSizeOptions,
  manualPagination = false,
  pageIndex: controlledPageIndex,
  pageCount: controlledPageCount,
  rowCount,
  onPageChange,
  rowsPerPageLabel = 'Rows per page',
  paginationLabel = 'Pagination',
  firstPageLabel = 'First page',
  previousPageLabel = 'Previous page',
  nextPageLabel = 'Next page',
  lastPageLabel = 'Last page',
  renderRangeLabel,
  storageKey,
  getRowId,
  onRowClick,
  rowRole = 'button',
  getRowAriaLabel,
  toolbar,
  batchActions,
  columnsLabel = 'Columns',
  toggleColumnsLabel = 'Toggle columns',
  columnLabels,
  getSortLabel,
  ariaLabel,
  caption,
  defaultSorting = [],
  defaultVisibility,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(defaultSorting);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [pagination, setPagination] = useState({
    pageIndex: manualPagination ? (controlledPageIndex ?? 0) : 0,
    pageSize,
  });

  // In manual mode the page index is owned by the caller; mirror it in.
  useEffect(() => {
    if (!manualPagination) return;
    setPagination((p) =>
      p.pageIndex === (controlledPageIndex ?? 0) ? p : { ...p, pageIndex: controlledPageIndex ?? 0 });
  }, [manualPagination, controlledPageIndex]);

  // Keep the reactive page size in sync if the prop changes.
  useEffect(() => {
    setPagination((p) => (p.pageSize === pageSize ? p : { ...p, pageSize }));
  }, [pageSize]);
  const currentPageSize = pagination.pageSize;

  // Animate row entrance on initial mount only (not on every sort/page/filter).
  // prefers-reduced-motion is handled globally in globals.css.
  const hasAnimatedRef = useRef(false);
  const isFirstRender = !hasAnimatedRef.current;
  useEffect(() => { hasAnimatedRef.current = true; }, []);

  // Restore visibility from localStorage
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(`dt_vis_${storageKey}`);
      if (raw) {
        setColumnVisibility(JSON.parse(raw));
        return;
      }
    } catch {}
    if (defaultVisibility) setColumnVisibility(defaultVisibility);
  }, [storageKey, defaultVisibility]);

  // Persist visibility
  useEffect(() => {
    if (!storageKey || Object.keys(columnVisibility).length === 0) return;
    try { localStorage.setItem(`dt_vis_${storageKey}`, JSON.stringify(columnVisibility)); } catch {}
  }, [storageKey, columnVisibility]);

  // Inject select column if enabled
  const allColumns = React.useMemo(() => {
    if (!enableSelection) return columns;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the heterogeneous ColumnDef array above
    const selectCol: ColumnDef<TData, any> = {
      id: '__select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? 'indeterminate'
                : false
          }
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label={selectAllLabel}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label={selectRowLabel}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableSorting: false,
      enableHiding: false,
      meta: { stopRowClick: true },
    };
    return [selectCol, ...columns];
  }, [columns, enableSelection, selectAllLabel, selectRowLabel]);

  const tableOptions: TableOptions<TData> = {
    data,
    columns: allColumns,
    state: { sorting, columnVisibility, rowSelection, pagination },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: (updater) => {
      setPagination((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (manualPagination && next.pageIndex !== prev.pageIndex) {
          onPageChange?.(next.pageIndex);
        }
        return next;
      });
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(manualPagination
      ? { manualPagination: true as const, pageCount: controlledPageCount ?? -1 }
      : { getPaginationRowModel: getPaginationRowModel() }),
    autoResetPageIndex: !manualPagination,
    enableRowSelection: enableSelection,
    ...(getRowId ? { getRowId } : {}),
  };

  const table = useReactTable(tableOptions);

  // Notify parent of selection changes
  useEffect(() => {
    if (!onSelectionChange) return;
    const selected = table.getSelectedRowModel().rows.map(r => r.original);
    onSelectionChange(selected);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection]);

  const selectedCount = Object.keys(rowSelection).length;
  const colCount = table.getVisibleLeafColumns().length;

  // Build toggleable columns list (exclude __select and actions)
  const toggleableColumns = table.getAllColumns().filter(
    col => col.getCanHide() && col.id !== '__select'
  );

  const labelForColumn = (id: string) => columnLabels?.[id] ?? id;
  const sortLabel = (id: string) => {
    const label = labelForColumn(id);
    return getSortLabel ? getSortLabel(label) : `Sort by ${label}`;
  };

  // Pagination range read-out. In manual mode `data` is just the current page,
  // so the grand total comes from `rowCount` and the page offset from pageIndex.
  const pageIndex = table.getState().pagination.pageIndex;
  const total = manualPagination ? (rowCount ?? data.length) : data.length;
  const from = total === 0 ? 0 : pageIndex * currentPageSize + 1;
  const to = manualPagination
    ? Math.min(pageIndex * currentPageSize + data.length, total)
    : Math.min((pageIndex + 1) * currentPageSize, total);
  const rangeLabel = renderRangeLabel
    ? renderRangeLabel({ from, to, total })
    : `${from}–${to} of ${total}`;

  const headerCellClass = 'text-xs font-600 uppercase tracking-wide text-md-on-surface-variant';

  return (
    <div className="space-y-4">
      {/* Toolbar row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search — M3 search field on a tonal surface */}
        {onSearchChange && (
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Input
              type="search"
              size="sm"
              startIcon={<Search />}
              clearable={searchClearable}
              clearLabel={clearSearchLabel}
              aria-label={searchLabel}
              placeholder={searchPlaceholder}
              value={searchValue ?? ''}
              onValueChange={onSearchChange}
              debounceMs={searchDebounceMs > 0 ? searchDebounceMs : undefined}
              className="rounded-full border-transparent bg-md-surface-container-high text-foreground placeholder:text-md-on-surface-variant focus-visible:border-md-primary"
            />
          </div>
        )}

        {toolbar}

        {/* Column visibility */}
        {toggleableColumns.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 ml-auto rounded-full state-layer">
                <Settings2 className="h-4 w-4 mr-1.5" aria-hidden="true" />
                {columnsLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px] max-h-[400px] overflow-y-auto rounded-xl elevation-2">
              <DropdownMenuLabel className="font-display">{toggleColumnsLabel}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {toggleableColumns.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(!!v)}
                >
                  {labelForColumn(col.id)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Batch actions bar */}
      {selectedCount > 0 && batchActions && (
        <div
          role="region"
          aria-live="polite"
          aria-label={batchRegionLabel}
          className="flex items-center gap-3 rounded-xl bg-md-primary-container text-md-on-primary-container px-4 py-2.5 animate-slide-up"
        >
          <Badge variant="outline" className="rounded-full border-md-on-primary-container/30 bg-transparent text-md-on-primary-container font-display font-600">
            {renderSelectedCount ? renderSelectedCount(selectedCount) : `${selectedCount} selected`}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-full text-md-on-primary-container hover:bg-md-on-primary-container/10"
            onClick={() => { table.resetRowSelection(); onClearSelection?.(); }}
          >
            {clearSelectionLabel}
          </Button>
          <div className="flex gap-2 ml-auto">
            {batchActions}
          </div>
        </div>
      )}

      {/* Table */}
      <Card className="rounded-xl overflow-hidden">
        <CardContent className="p-0">
          <Table aria-label={ariaLabel}>
            {caption && <caption className="sr-only">{caption}</caption>}
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="border-b border-md-outline-variant bg-md-surface-container-high/50 hover:bg-md-surface-container-high/50">
                  {hg.headers.map((header: Header<TData, unknown>) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    const ariaSort = sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none';
                    const headerContent = header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext());
                    return (
                      <TableHead
                        key={header.id}
                        aria-sort={canSort ? ariaSort : undefined}
                        className={headerCellClass}
                      >
                        {canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            aria-label={sortLabel(header.column.id)}
                            className="inline-flex items-center gap-1 whitespace-nowrap select-none rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                          >
                            {headerContent}
                            {sorted === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-md-primary" aria-hidden="true" /> :
                              sorted === 'desc' ? <ArrowDown className="h-3.5 w-3.5 text-md-primary" aria-hidden="true" /> :
                              <ArrowUpDown className="h-3.5 w-3.5 opacity-30" aria-hidden="true" />}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            {headerContent}
                          </span>
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                loadingVariant === 'skeleton' ? (
                  <>
                    {Array.from({ length: 5 }).map((_, r) => (
                      <TableRow key={`sk-${r}`} className="hover:bg-transparent" aria-hidden="true">
                        {Array.from({ length: Math.max(colCount, 1) }).map((__, c) => (
                          <TableCell key={c} className="py-3.5">
                            <div className="h-4 w-full max-w-[160px] rounded bg-md-on-surface/[0.08] animate-pulse" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={colCount} className="p-0">
                        <div role="status" aria-live="polite" className="sr-only">Loading</div>
                      </TableCell>
                    </TableRow>
                  </>
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={colCount} className="text-center py-20">
                      <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
                        <div className="h-7 w-7 rounded-full border-[3px] border-md-primary/25 border-t-md-primary animate-spin" aria-hidden="true" />
                        <span className="sr-only">Loading</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={colCount} className="text-center py-20 text-md-on-surface-variant">
                    <div className="flex flex-col items-center gap-3">
                      <span>
                        {((isFiltered || searchValue?.trim()) ? emptyFilteredMessage : null) ?? emptyMessage}
                      </span>
                      {emptyAction && <div>{emptyAction}</div>}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row: Row<TData>, i) => {
                  const clickable = Boolean(onRowClick);
                  const handleActivate = clickable ? () => onRowClick!(row.original) : undefined;
                  return (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && 'selected'}
                      role={clickable ? rowRole : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      aria-label={clickable ? getRowAriaLabel?.(row.original) : undefined}
                      className={`border-b border-md-outline-variant/60 transition-colors hover:bg-md-on-surface/[0.04] data-[state=selected]:bg-md-primary-container/40 ${isFirstRender ? 'animate-slide-up' : ''} ${clickable ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-md-primary/50' : ''}`}
                      style={isFirstRender ? { animationDelay: `${Math.min(i, 12) * 30}ms` } : undefined}
                      onClick={handleActivate}
                      onKeyDown={clickable ? (e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleActivate?.();
                        }
                      } : undefined}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const meta = cell.column.columnDef.meta;
                        const stop = meta?.stopRowClick
                          ?? (cell.column.id === '__select' || cell.column.id === 'actions');
                        return (
                          <TableCell
                            key={cell.id}
                            className="py-3"
                            onClick={stop ? (e) => e.stopPropagation() : undefined}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {!loading && total > 0 && (
        <nav aria-label={paginationLabel} className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-4">
            <span className="text-md-on-surface-variant tabular-nums" aria-live="polite">
              {rangeLabel}
            </span>
            {pageSizeOptions && pageSizeOptions.length > 1 && (
              <label className="flex items-center gap-2 text-md-on-surface-variant">
                <span className="whitespace-nowrap">{rowsPerPageLabel}</span>
                <Select
                  value={String(currentPageSize)}
                  onValueChange={(v) => setPagination((p) => ({ ...p, pageIndex: 0, pageSize: Number(v) }))}
                >
                  <SelectTrigger size="sm" className="w-[72px]" aria-label={rowsPerPageLabel}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pageSizeOptions.map((opt) => (
                      <SelectItem key={opt} value={String(opt)}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
          </div>
          {table.getPageCount() > 1 && (
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="icon" aria-label={firstPageLabel}
                className="h-10 w-10 pointer-coarse:h-12 pointer-coarse:w-12 rounded-full state-layer"
                onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
                <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button variant="outline" size="icon" aria-label={previousPageLabel}
                className="h-10 w-10 pointer-coarse:h-12 pointer-coarse:w-12 rounded-full state-layer"
                onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span className="px-3 font-display font-600 text-foreground tabular-nums" aria-live="polite">
                {pageIndex + 1} / {table.getPageCount()}
              </span>
              <Button variant="outline" size="icon" aria-label={nextPageLabel}
                className="h-10 w-10 pointer-coarse:h-12 pointer-coarse:w-12 rounded-full state-layer"
                onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button variant="outline" size="icon" aria-label={lastPageLabel}
                className="h-10 w-10 pointer-coarse:h-12 pointer-coarse:w-12 rounded-full state-layer"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>
                <ChevronsRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )}
        </nav>
      )}
    </div>
  );
}
