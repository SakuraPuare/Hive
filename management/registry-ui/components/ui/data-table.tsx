import React, { useEffect, useState } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel,
  flexRender,
  type ColumnDef, type SortingState, type VisibilityState, type RowSelectionState,
  type TableOptions,
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
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ArrowUp, ArrowDown, ArrowUpDown, Search, Settings2,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from 'lucide-react';

const DEFAULT_PAGE_SIZE = 20;

interface DataTableProps<TData> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TanStack columns hold heterogeneous cell value types
  columns: ColumnDef<TData, any>[];
  data: TData[];
  loading?: boolean;
  emptyMessage?: string;
  emptyFilteredMessage?: string;

  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;

  enableSelection?: boolean;
  onSelectionChange?: (rows: TData[]) => void;

  pageSize?: number;
  storageKey?: string;

  getRowId?: (row: TData) => string;
  onRowClick?: (row: TData) => void;

  toolbar?: React.ReactNode;
  batchActions?: React.ReactNode;

  columnLabels?: Record<string, string>;

  defaultSorting?: SortingState;
  defaultVisibility?: VisibilityState;
}

export function DataTable<TData>({
  columns,
  data,
  loading = false,
  emptyMessage = 'No data.',
  emptyFilteredMessage,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  enableSelection = false,
  onSelectionChange,
  pageSize = DEFAULT_PAGE_SIZE,
  storageKey,
  getRowId,
  onRowClick,
  toolbar,
  batchActions,
  columnLabels,
  defaultSorting = [],
  defaultVisibility,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(defaultSorting);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

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
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="Select row"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    };
    return [selectCol, ...columns];
  }, [columns, enableSelection]);

  const tableOptions: TableOptions<TData> = {
    data,
    columns: allColumns,
    state: { sorting, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
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

  return (
    <div className="space-y-4">
      {/* Toolbar row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search — M3 search field on a tonal surface */}
        {onSearchChange && (
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-md-on-surface-variant" />
            <Input
              placeholder={searchPlaceholder}
              value={searchValue ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-10 pl-10 rounded-full border-transparent bg-md-surface-container-high text-foreground placeholder:text-md-on-surface-variant focus-visible:border-md-primary"
            />
          </div>
        )}

        {toolbar}

        {/* Column visibility */}
        {toggleableColumns.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 ml-auto rounded-full state-layer">
                <Settings2 className="h-4 w-4 mr-1.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px] max-h-[400px] overflow-y-auto rounded-xl elevation-2">
              <DropdownMenuLabel className="font-display">Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {toggleableColumns.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(!!v)}
                >
                  {columnLabels?.[col.id] ?? col.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Batch actions bar */}
      {selectedCount > 0 && batchActions && (
        <div className="flex items-center gap-3 rounded-xl bg-md-primary-container text-md-on-primary-container px-4 py-2.5 animate-slide-up">
          <Badge variant="outline" className="rounded-full border-md-on-primary-container/30 bg-transparent text-md-on-primary-container font-display font-600">
            {selectedCount} selected
          </Badge>
          <div className="flex gap-2 ml-auto">
            {batchActions}
          </div>
        </div>
      )}

      {/* Table */}
      <Card className="rounded-xl overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="border-b border-md-outline-variant bg-md-surface-container-high/50 hover:bg-md-surface-container-high/50">
                  {hg.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    return (
                      <TableHead
                        key={header.id}
                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                        className={`text-xs font-600 uppercase tracking-wide text-md-on-surface-variant ${canSort ? 'cursor-pointer select-none transition-colors hover:text-foreground' : ''}`}
                      >
                        <span className="inline-flex items-center gap-1 whitespace-nowrap">
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            sorted === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-md-primary" /> :
                            sorted === 'desc' ? <ArrowDown className="h-3.5 w-3.5 text-md-primary" /> :
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
                          )}
                        </span>
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={colCount} className="text-center py-20">
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-7 w-7 rounded-full border-[3px] border-md-primary/25 border-t-md-primary animate-spin" />
                    </div>
                  </TableCell>
                </TableRow>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={colCount} className="text-center py-20 text-md-on-surface-variant">
                    {(searchValue?.trim() ? emptyFilteredMessage : null) ?? emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row, i) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && 'selected'}
                    className={`border-b border-md-outline-variant/60 transition-colors hover:bg-md-on-surface/[0.04] data-[state=selected]:bg-md-primary-container/40 animate-slide-up ${onRowClick ? 'cursor-pointer' : ''}`}
                    style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const isInteractive = cell.column.id === '__select' || cell.column.id === 'actions';
                      return (
                        <TableCell
                          key={cell.id}
                          className="py-3"
                          onClick={isInteractive ? (e) => e.stopPropagation() : undefined}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-md-on-surface-variant">
            {data.length} rows
          </span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-full state-layer"
              onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-full state-layer"
              onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 font-display font-600 text-foreground tabular-nums">
              {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
            </span>
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-full state-layer"
              onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-full state-layer"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
