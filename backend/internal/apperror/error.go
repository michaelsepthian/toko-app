package apperror

type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string      { return e.Message }
func Invalid(message string) error  { return &Error{400, message} }
func Conflict(message string) error { return &Error{409, message} }
func Forbidden() error              { return &Error{403, "Akses tidak diizinkan"} }
