/** Preview-only specimens for financial.money-figure. Never imported by the app. Figures are illustrative. */
import * as React from "react";

import { ListGroup, ListRow, StatusBadge } from "@/components/creatorco";
import { MoneyFigure } from "@/components/creatorco/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const SHARED = {};
export const AFTER = {
  MoneyFigureDemo: () => (
    <div className="flex min-h-full max-w-xl flex-col gap-6 bg-paper p-5 text-ink">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Proposed eligibility</CardTitle>
            <StatusBadge tone="info">CreatorCo recommendation</StatusBadge>
          </div>
          <CardDescription>Subject to partner-lender approval.</CardDescription>
        </CardHeader>
        <CardContent>
          <MoneyFigure amount={150000} max={200000} size="title" label="Proposed eligibility" />
        </CardContent>
      </Card>
      <ListGroup id="money" label="Formats">
        <ListRow label="Full" value={<MoneyFigure amount={150000} />} />
        <ListRow label="Large full" value={<MoneyFigure amount={12345678} />} />
        <ListRow label="Compact (lakh)" value={<MoneyFigure amount={150000} compact />} />
        <ListRow label="Compact (crore)" value={<MoneyFigure amount={20000000} compact />} />
        <ListRow label="Compact range" value={<MoneyFigure amount={150000} max={200000} compact />} />
      </ListGroup>
    </div>
  ),
};
