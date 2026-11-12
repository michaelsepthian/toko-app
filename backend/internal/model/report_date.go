package model

import (
	"database/sql/driver"
	"fmt"
	"time"
)

type ReportDate string

func (d ReportDate) Value() (driver.Value, error) { return string(d), nil }

func (d *ReportDate) Scan(value any) error {
	switch value := value.(type) {
	case time.Time:
		*d = ReportDate(value.Format("2006-01-02"))
	case string:
		*d = ReportDate(value)
	case []byte:
		*d = ReportDate(string(value))
	default:
		return fmt.Errorf("tanggal laporan tidak valid")
	}
	return nil
}
