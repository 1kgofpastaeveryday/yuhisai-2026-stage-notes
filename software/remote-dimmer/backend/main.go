package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, out io.Writer) error {
	flags := flag.NewFlagSet("remote-dimmer", flag.ContinueOnError)
	configPath := flags.String("config", "config.json", "configuration file")
	if err := flags.Parse(args); err != nil {
		return err
	}
	c, err := loadConfig(*configPath)
	if err != nil {
		return err
	}
	if flags.NArg() > 0 {
		return adminCLI(c, flags.Args(), out)
	}
	logs, err := os.OpenFile(c.LogFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer logs.Close()
	r, err := newRuntime(c, io.MultiWriter(out, logs))
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", c.Listen)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	server := &http.Server{Handler: r.handler(), ReadHeaderTimeout: 5 * time.Second}
	var public *http.Server
	var publicListener net.Listener
	if c.PublicListen != "" {
		if publicListener, err = net.Listen("tcp", c.PublicListen); err != nil {
			listener.Close()
			return err
		}
		public = &http.Server{Handler: r.publicHandler(), ReadHeaderTimeout: 5 * time.Second}
	}
	r.start()
	errCh := make(chan error, 2)
	go func() { errCh <- server.Serve(listener) }()
	if public != nil {
		go func() { errCh <- public.Serve(publicListener) }()
	}
	select {
	case <-ctx.Done():
	case err = <-errCh:
	}
	r.shutdown()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
	if public != nil {
		_ = public.Shutdown(shutdownCtx)
	}
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}

func adminCLI(c Config, args []string, out io.Writer) error {
	method, path := "POST", ""
	var body any
	switch {
	case len(args) == 1 && args[0] == "devices":
		method, path = "GET", "/admin/devices"
	case len(args) == 3 && args[0] == "assign":
		path, body = "/admin/assign", map[string]string{"device": args[1], "fixture": args[2]}
	case len(args) == 2 && args[0] == "forget":
		path, body = "/admin/forget", map[string]string{"device": args[1]}
	case len(args) == 2 && args[0] == "release":
		path, body = "/admin/release", map[string]string{"fixture": args[1]}
	default:
		return fmt.Errorf("usage: remote-dimmer [-config path] [devices | assign <device> <fixture> | release <fixture> | forget <device>]")
	}
	host, port, err := net.SplitHostPort(c.Listen)
	if err != nil {
		return err
	}
	// CLI administration always originates from and targets this machine.
	if ip := net.ParseIP(host); host == "" || host == "localhost" || (ip != nil && ip.IsUnspecified()) {
		host = "127.0.0.1"
	}
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		if strings.Contains(host, ":") {
			host = "::1"
		} else {
			host = "127.0.0.1"
		}
	}
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(method, "http://"+net.JoinHostPort(host, port)+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if _, err = io.Copy(out, resp.Body); err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("admin request: %s", resp.Status)
	}
	return nil
}
