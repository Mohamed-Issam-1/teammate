import type { ReactNode } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";

type AuthCardProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <Card className="w-full max-w-md shadow-sm">
      <CardHeader className="px-5 pt-5 sm:px-6 sm:pt-6">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">
          {description}
        </p>
      </CardHeader>
      <CardContent className="px-5 pb-5 sm:px-6 sm:pb-6">
        {children}
      </CardContent>
    </Card>
  );
}
