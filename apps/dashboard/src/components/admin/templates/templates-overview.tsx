'use client';

import { useState, type ReactElement } from 'react';
import type { EquipmentType } from '@mat-inspect/shared-types';
import { equipmentTypeSchema, type ChecklistTemplate } from '@mat-inspect/shared-schemas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useChecklistTemplates } from '@/hooks/use-checklist-templates';
import { TemplateDetailView } from './template-detail-view';
import { PublishTemplateWizard } from './publish-template-wizard';

const EquipmentTypeSection = ({
  equipmentType,
  templates,
  onPublish,
}: {
  equipmentType: EquipmentType;
  templates: ChecklistTemplate[];
  onPublish: () => void;
}): ReactElement => {
  const [viewingId, setViewingId] = useState<string | null>(null);

  const active = templates.find((t) => t.isActive) ?? null;
  const history = [...templates].sort((a, b) => b.version - a.version);
  const viewing = templates.find((t) => t.id === viewingId) ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-baseline gap-2">
          <CardTitle>{equipmentType}</CardTitle>
          {active && (
            <span className="text-sm font-normal text-muted-foreground">v{active.version}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {active ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="secondary">No active template</Badge>
          )}
          <Button type="button" onClick={onPublish}>
            Publish new version
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {history.length === 0 && (
          <p className="text-sm text-muted-foreground">No templates published yet.</p>
        )}

        {history.map((template) => (
          <div key={template.id} className="flex items-center justify-between text-sm">
            <span>v{template.version}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setViewingId((id) => (id === template.id ? null : template.id))}
            >
              {viewingId === template.id ? 'Hide items' : 'View items'}
            </Button>
          </div>
        ))}

        {viewing && (
          <div className="mt-2 overflow-x-auto rounded-sm border border-border">
            <TemplateDetailView items={viewing.items} />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export const TemplatesOverview = (): ReactElement => {
  const { data: templates, isLoading, error } = useChecklistTemplates();
  const [publishingType, setPublishingType] = useState<EquipmentType | null>(null);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading templates…</p>;
  if (error)
    return <p className="text-sm text-destructive">Failed to load templates: {error.message}</p>;

  const byType = templates ?? [];
  const activeForPublishingType =
    byType.find((t) => t.equipmentType === publishingType && t.isActive) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {equipmentTypeSchema.options.map((equipmentType) => (
        <EquipmentTypeSection
          key={equipmentType}
          equipmentType={equipmentType}
          templates={byType.filter((t) => t.equipmentType === equipmentType)}
          onPublish={() => setPublishingType(equipmentType)}
        />
      ))}

      {publishingType && (
        <PublishTemplateWizard
          equipmentType={publishingType}
          currentActive={activeForPublishingType}
          onClose={() => setPublishingType(null)}
        />
      )}
    </div>
  );
};
