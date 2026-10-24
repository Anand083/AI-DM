import { Heading, Link, Text } from "@react-email/components";
import { buttonStyle, EmailLayout } from "./layout";

export type ResetPasswordProps = { brandName: string; name: string; url: string };

export function ResetPassword({ brandName, name, url }: ResetPasswordProps) {
  return (
    <EmailLayout preview="Reset your password" brandName={brandName}>
      <Heading as="h1" style={{ fontSize: 22 }}>
        Reset your password
      </Heading>
      <Text>Hi {name},</Text>
      <Text>We got a request to reset your password. This link works for one hour.</Text>
      <Link href={url} style={buttonStyle}>
        Choose a new password
      </Link>
      <Text style={{ fontSize: 12, color: "#71717a" }}>
        If you did not ask for this, you can ignore this email. Your password will not change.
      </Text>
    </EmailLayout>
  );
}
