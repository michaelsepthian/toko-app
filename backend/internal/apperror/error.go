package apperror

type Error struct {
	Status  int
	Message string
	Code    string
}

func (e *Error) Error() string      { return e.Message }
func Invalid(message string) error  { return &Error{Status: 400, Message: message} }
func Conflict(message string) error { return &Error{Status: 409, Message: message} }
func Forbidden() error              { return &Error{Status: 403, Message: "Akses tidak diizinkan"} }
