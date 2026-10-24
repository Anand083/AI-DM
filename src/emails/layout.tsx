import { Body, Container, Head, Html, Preview, Text } from "@react-email/components";
import type { ReactNode } from "react";

export type EmailLayoutProps = {
  preview: string;
  /** Name shown in the footer. Client emails pass the agency name, never the platform name. */
  brandName: string;
  children: ReactNode;
};

export function EmailLayout({ preview, brandName, children }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f4f4f5", fontFamily: "Arial, sans-serif", margin: 0 }}>
        <Container
          style={{
            backgroundColor: "#ffffff",
            margin: "24px auto",
            padding: "24px",
            maxWidth: 480,
          }}
        >
          {children}
          <Text style={{ color: "#71717a", fontSize: 12, marginTop: 32 }}>Sent by {brandName}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export const buttonStyle = {
  backgroundColor: "#18181b",
  color: "#ffffff",
  padding: "12px 20px",
  borderRadius: 6,
  textDecoration: "none",
  display: "inline-block",
} as const;
