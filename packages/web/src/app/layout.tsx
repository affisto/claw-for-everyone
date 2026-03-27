export const metadata = {
  title: "Claw for Everyone — AI Worker Platform",
  description: "Assign 24/7 AI agents to your channels",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
