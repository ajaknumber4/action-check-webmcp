import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CheckBuilder } from "../src/app/CheckBuilder";

afterEach(cleanup);

function urlField() {
  return screen.getByLabelText("Target page URL");
}
function toolField() {
  return screen.getByLabelText("Registered tool name");
}
function inputField() {
  return screen.getByLabelText("Tool input (JSON)");
}

describe("CheckBuilder", () => {
  it("renders a runnable command and an observe module from the defaults", () => {
    render(<CheckBuilder />);
    const command = screen.getByLabelText("Command line for this check");
    expect(command).toHaveTextContent("node bin/action-check.mjs run");
    expect(command).toHaveTextContent("--observe examples/observe-googlechromelabs-github-io.mjs");
    expect(screen.getByLabelText(/observe module for/)).toHaveTextContent(
      "export default async function observe(ctx)",
    );
  });

  it("says plainly that nothing runs in the page, and why", () => {
    // The page must not imply it can check another origin. It cannot: WebMCP
    // tools live on a document's own model context.
    render(<CheckBuilder />);
    expect(screen.getByText(/Nothing runs here/)).toBeInTheDocument();
    expect(screen.getByText(/document\.modelContext/)).toBeInTheDocument();
  });

  it("rebuilds the command when the target changes", () => {
    render(<CheckBuilder />);
    fireEvent.change(urlField(), { target: { value: "https://shop.example/cart" } });
    fireEvent.change(toolField(), { target: { value: "place_order" } });
    const command = screen.getByLabelText("Command line for this check");
    expect(command).toHaveTextContent("--url 'https://shop.example/cart'");
    expect(command).toHaveTextContent("--tool 'place_order'");
    expect(command).toHaveTextContent("--observe examples/observe-shop-example.mjs");
  });

  it("switches the emitted mode and the semantics the template explains", () => {
    render(<CheckBuilder />);
    fireEvent.click(screen.getByRole("radio", { name: /once/ }));
    expect(screen.getByLabelText("Command line for this check")).toHaveTextContent("--mode once");
    expect(screen.getByLabelText(/observe module for/)).toHaveTextContent("FALSE_SUCCESS");
  });

  it("withholds the output and explains why when the JSON is invalid", () => {
    render(<CheckBuilder />);
    fireEvent.change(inputField(), { target: { value: "{sku:1}" } });
    expect(screen.queryByLabelText("Command line for this check")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("valid JSON");
    expect(inputField()).toHaveAttribute("aria-invalid", "true");
  });

  it("withholds the output for a non-http target", () => {
    render(<CheckBuilder />);
    fireEvent.change(urlField(), { target: { value: "file:///etc/passwd" } });
    expect(screen.queryByLabelText("Command line for this check")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("http or https");
  });

  it("recovers once the invalid field is corrected", () => {
    render(<CheckBuilder />);
    fireEvent.change(inputField(), { target: { value: "nope" } });
    expect(screen.queryByLabelText("Command line for this check")).not.toBeInTheDocument();
    fireEvent.change(inputField(), { target: { value: '{"id":1}' } });
    expect(screen.getByLabelText("Command line for this check")).toHaveTextContent(`'{"id":1}'`);
  });

  it("gives each output block its own copy control", () => {
    render(<CheckBuilder />);
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("button", { name: /copy/i })).toHaveLength(2);
  });

  it("names the file the reader is told to save, in the heading and the command", () => {
    render(<CheckBuilder />);
    fireEvent.change(urlField(), { target: { value: "https://www.shop.example/cart" } });
    expect(screen.getByRole("heading", { name: /observe-shop-example\.mjs/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Command line for this check")).toHaveTextContent(
      "observe-shop-example.mjs",
    );
  });
});
