package service

import (
	"context"
	"strings"
	"testing"
)

func TestCreateUserRejectsInvalidInputBeforeDatabase(t *testing.T) {
	valid := CreateUserInput{Nama: "Kasir Toko", Username: "kasir.baru", Password: "password-test", Peran: "KASIR"}
	for _, field := range []string{"nama", "nama panjang", "username", "password pendek", "password panjang", "password multibyte", "role"} {
		t.Run(field, func(t *testing.T) {
			in := valid
			switch field {
			case "nama":
				in.Nama = "  "
			case "nama panjang":
				in.Nama = strings.Repeat("a", 101)
			case "username":
				in.Username = "bad username"
			case "password pendek":
				in.Password = "short"
			case "password panjang":
				in.Password = strings.Repeat("x", 73)
			case "password multibyte":
				in.Password = strings.Repeat("漢", 25)
			case "role":
				in.Peran = "ADMIN"
			}
			if _, err := (&Service{}).CreateUser(context.Background(), in); err == nil {
				t.Fatal("invalid input accepted")
			}
		})
	}
}
