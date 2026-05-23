"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteAccount } from "@/lib/settings-actions";
import { useToast } from "@/components/toast";
import { signOut } from "next-auth/react";

export function SettingsDangerZone() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const { toast } = useToast();

  const confirmText = "delete my account";

  async function handleDelete() {
    if (confirm.toLowerCase() !== confirmText) return;
    setPending(true);
    try {
      const result = await deleteAccount();
      if (result.error) {
        toast({ message: result.error, type: "error" });
        setPending(false);
      } else {
        toast({ message: "Account deleted. Signing out…", type: "info" });
        await signOut({ callbackUrl: "/login" });
      }
    } catch {
      toast({ message: "Failed to delete account.", type: "error" });
      setPending(false);
    }
  }

  return (
    <Card className="border-destructive/50 ring-destructive/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Trash2 className="h-4 w-4" />
          Danger Zone
        </CardTitle>
        <CardDescription>
          Irreversible actions. Proceed with caution.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border border-destructive/30 p-4">
          <div>
            <p className="text-sm font-medium">Delete account</p>
            <p className="text-xs text-muted-foreground">
              Permanently delete your account and all associated data.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger>
              <Button variant="destructive" size="sm">
                Delete account
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete account</DialogTitle>
                <DialogDescription>
                  This action cannot be undone. All your agents and data will be
                  permanently deleted.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-2">
                <Label htmlFor="confirm-delete">
                  Type{" "}
                  <span className="font-mono font-semibold">{confirmText}</span>{" "}
                  to confirm
                </Label>
                <Input
                  id="confirm-delete"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={confirmText}
                  autoComplete="off"
                />
              </div>
              <DialogFooter>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={confirm.toLowerCase() !== confirmText || pending}
                  onClick={handleDelete}
                >
                  {pending ? "Deleting…" : "Delete my account"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
