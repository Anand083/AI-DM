import { Heading, Link, Text } from "@react-email/components";
import { buttonStyle, EmailLayout } from "./layout";

export type VerifyEmailProps = { brandName: string; name: string; url: string };

export function VerifyEmail({ brandName, name, url }: VerifyEmailProps) {
  return (
    <EmailLayout preview="Confirm your email address" brandName={brandName}>
      <Heading as="h1" style={{ fontSize: 22 }}>
        Confirm your email
      </Heading>
      <Text>Hi {name},</Text>
      <Text>Please confirm your email address to finish setting up your account.</Text>
      <Link href={url} style={buttonStyle}>
        Confirm email
      </Link>
      <Text style={{ fontSize: 12, color: "#71717a" }}>
        If the button does not work, copy this link into your browser: {url}
      </Text>
    </EmailLayout>
  );
}
