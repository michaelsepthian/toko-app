package httpapi

import (
	"testing"
	"time"
)

func TestHistoryDayDefaultsToTodayInJakarta(t *testing.T) {
	now := time.Date(2026, 10, 28, 18, 0, 0, 0, time.UTC)
	start, end, err := historyDay("", now)
	if err != nil {
		t.Fatal(err)
	}
	if !start.Equal(time.Date(2026, 10, 28, 17, 0, 0, 0, time.UTC)) || !end.Equal(time.Date(2026, 10, 29, 17, 0, 0, 0, time.UTC)) {
		t.Fatalf("wrong WIB day: %v - %v", start, end)
	}
}

func TestHistoryDaySpecificDateAndBoundary(t *testing.T) {
	start, end, err := historyDay("2024-02-29", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if start.Format("2006-01-02") != "2024-02-29" || end.Format("2006-01-02") != "2024-03-01" || end.Sub(start) != 24*time.Hour {
		t.Fatalf("wrong day boundary: %v - %v", start, end)
	}
}

func TestHistoryDayRejectsInvalidDates(t *testing.T) {
	for _, value := range []string{"2026-02-29", "2026-13-01", "2026-10-32", "2026-1-01", "29/10/2026", "2026-10-29T00:00:00Z", "2026-10-29' OR true"} {
		if _, _, err := historyDay(value, time.Now()); err == nil {
			t.Errorf("accepted invalid date %q", value)
		}
	}
}
