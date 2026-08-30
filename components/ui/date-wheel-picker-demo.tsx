import { useState } from "react";
import { DateWheelPicker } from "@/components/ui/date-wheel-picker";

export default function DateWheelPickerDemo() {
  const [date, setDate] = useState(new Date(1990, 5, 15));
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 bg-background">
      <DateWheelPicker value={date} onChange={setDate} size="md" />
      <p className="text-sm text-muted-foreground mt-2">
        {date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
      </p>
    </div>
  );
}
