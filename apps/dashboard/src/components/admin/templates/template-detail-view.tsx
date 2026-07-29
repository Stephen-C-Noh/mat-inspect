import type { ReactElement } from 'react';
import type { ChecklistItem } from '@mat-inspect/shared-schemas';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Props = { items: ChecklistItem[] };

// Read-only view of one template version's items. Reused both for browsing publish history
// and, inside the publish wizard, as the "current active" reference the admin is editing from.
export const TemplateDetailView = ({ items }: Props): ReactElement => {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Prompt</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Required</TableHead>
          <TableHead>Fail severity</TableHead>
          <TableHead>Regulatory reference</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.key}>
            <TableCell className="font-mono text-xs">{item.key}</TableCell>
            <TableCell>{item.prompt}</TableCell>
            <TableCell>{item.type}</TableCell>
            <TableCell>{item.required ? 'Yes' : 'No'}</TableCell>
            <TableCell>{item.failSeverity}</TableCell>
            <TableCell>{item.regulatoryReference ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
