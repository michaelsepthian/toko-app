package repository

import "errors"

var ErrInvalidTransactionKind = errors.New("invalid transaction kind")

func IsUniqueViolation(err error) bool {
	var state interface{ SQLState() string }
	return errors.As(err, &state) && state.SQLState() == "23505"
}
