import React from "react"
import { render, cleanup } from "@testing-library/react"
import { ErrorBoundary } from "../ErrorBoundary"

describe("<ErrorBoundary />", () => {
  let instance: any

  const Broken = () => {
    throw new Error("From component")
    return <div></div>
  }

  const mock: any = {
    setAction: jest.fn(() => mock),
    setError: jest.fn(() => mock),
    setTags: jest.fn(() => mock)
  }

  const SpanMock = jest.fn().mockImplementation(() => mock)

  beforeEach(() => {
    instance = {
      createSpan: () => new SpanMock(),
      send: jest.fn()
    }
  })

  afterEach(() => {
    cleanup()
  })

  it("catches an error from its children", () => {
    render(
      <ErrorBoundary instance={instance}>
        <Broken />
      </ErrorBoundary>
    )

    expect(mock.setAction).toBeCalledWith(undefined)
    expect(mock.setTags).toBeCalledWith({ framework: "React" })
    expect(mock.setError).toBeCalled()

    expect(instance.send).toBeCalled()
  })

  it("modifies the action if provided as a prop", () => {
    render(
      <ErrorBoundary instance={instance} action="testaction">
        <Broken />
      </ErrorBoundary>
    )

    expect(mock.setAction).toBeCalledWith("testaction")
    expect(mock.setTags).toBeCalledWith({ framework: "React" })
    expect(mock.setError).toBeCalled()

    expect(instance.send).toBeCalled()
  })

  it("renders a fallback if available", () => {
    const { queryByText } = render(
      <ErrorBoundary instance={instance} fallback={() => <div>Fallback</div>}>
        <Broken />
      </ErrorBoundary>
    )

    expect(queryByText("Fallback")).toBeDefined()
  })
})
