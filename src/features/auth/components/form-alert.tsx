import { CircleAlert, CircleCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";

type FormAlertProps = {
  children: string;
  tone: "error" | "success";
};

export function FormAlert({ children, tone }: FormAlertProps) {
  const isError = tone === "error";
  const Icon = isError ? CircleAlert : CircleCheck;

  return (
    <Alert
      variant={isError ? "destructive" : "success"}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      tabIndex={-1}
      autoFocus
    >
      <Icon aria-hidden="true" />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
