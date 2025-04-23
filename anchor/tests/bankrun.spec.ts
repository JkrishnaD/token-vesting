import { Tokenvesting } from './../target/types/tokenvesting';
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { BanksClient, Clock, ProgramTestContext, startAnchor } from "solana-bankrun";

import IDL from "../target/idl/tokenvesting.json"
import { SYSTEM_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/native/system";
import { BankrunProvider } from "anchor-bankrun";
import { MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeMintInstruction, createMint, createMintToInstruction, getMinimumBalanceForRentExemptMint, mintTo } from '@solana/spl-token';
import NodeWallet from '@coral-xyz/anchor/dist/cjs/nodewallet';
import { BN } from '@coral-xyz/anchor';


describe("Testing the vesting program", () => {
    let companyName = "companyName";
    let beneficiary: Keypair;
    let context: ProgramTestContext;
    let provider: BankrunProvider;
    let program: anchor.Program<Tokenvesting>
    let banksClient: BanksClient
    let employer: Keypair;
    let mint: PublicKey;
    let benificiaryProvider: BankrunProvider;
    let program2: anchor.Program<Tokenvesting>
    let vestingAccountKey: PublicKey;
    let treasuryTokenAccount: PublicKey;
    let employeeAccount: PublicKey;
    const mintKeypair = new anchor.web3.Keypair();


    beforeAll(async () => {
        beneficiary = new anchor.web3.Keypair();

        context = await startAnchor("", [{ name: "tokenvesting", programId: new PublicKey(IDL.address) }], [{
            address: beneficiary.publicKey,
            info: {
                lamports: 1_000_000_000,
                data: Buffer.alloc(0),
                owner: SYSTEM_PROGRAM_ID,
                executable: false
            }
        }]);

        provider = new BankrunProvider(context);
        anchor.setProvider(provider);

        program = new anchor.Program<Tokenvesting>(IDL as Tokenvesting, provider);
        banksClient = context.banksClient;
        employer = provider.wallet.payer;

        // Create and initialize the mint account
        const lamports = await getMinimumBalanceForRentExemptMint(provider.connection, "confirmed");
        const tx = new Transaction().add(
            SystemProgram.createAccount({
                fromPubkey: employer.publicKey,
                newAccountPubkey: mintKeypair.publicKey,
                lamports,
                space: MINT_SIZE,
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMintInstruction(
                mintKeypair.publicKey,
                2,
                employer.publicKey,
                null
            )
        );

        await provider.sendAndConfirm!(tx, [employer, mintKeypair]);

        mint = mintKeypair.publicKey;

        benificiaryProvider = new BankrunProvider(context);
        benificiaryProvider.wallet = new NodeWallet(beneficiary);
        program2 = new anchor.Program<Tokenvesting>(IDL as Tokenvesting, benificiaryProvider);

        [vestingAccountKey] = PublicKey.findProgramAddressSync(
            [Buffer.from(companyName)], program.programId
        );

        [treasuryTokenAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("vesting_treasure"), Buffer.from(companyName)], program.programId
        );

        [employeeAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("employee_vesting"), beneficiary.publicKey.toBuffer(), vestingAccountKey.toBuffer()],
            program.programId
        );
    });

    it("should creating a vesting account", async () => {
        const tx = await program.methods.createVestingAccount(companyName).accounts({
            signer: employer.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc({ commitment: "confirmed" });

        const vestingAccountData = await program.account.vestingAccount.fetch(vestingAccountKey, 'confirmed');
        console.log("Vesting account data", vestingAccountData);
        console.log("Transaction signature", tx);

    })

    it("should fund the treasury account", async () => {
        let amount = 100_000 * 10 ** 9;
        let mintTx = createMintToInstruction(
            mint,
            treasuryTokenAccount,
            employer.publicKey,
            amount,
        )
        const tx = new Transaction().add(mintTx);
        const sign = await provider.sendAndConfirm!(tx, [employer])

        console.log("mint tx signature", sign);
    })

    it("should create a employee vesting account", async () => {
        const tx2 = await program.methods
            .createEmployeeAccount(
                new BN(0),      // start_time
                new BN(1000),   // end_time
                new BN(1000),      // total_amount
                new BN(100)
            )
            .accounts({
                benificiary: beneficiary.publicKey,
                vestingAccount: vestingAccountKey,
            })
            .signers([employer])
            .rpc({ commitment: "confirmed", skipPreflight: true });

        console.log("Transaction signature", tx2);
    });

    it("should claim the vesting amount", async () => {
        await new Promise((reslove) => setTimeout(reslove, 1000));

        const currentClock = await banksClient.getClock();
        context.setClock(new Clock(
            currentClock.slot,
            currentClock.epochStartTimestamp,
            currentClock.epoch,
            currentClock.leaderScheduleEpoch,
            BigInt(1000),
        ));
        
        const tx3 = await program2.methods.claimTokens(companyName)
            .accounts({ tokenProgram: TOKEN_PROGRAM_ID, })
            .rpc({ commitment: "confirmed", skipPreflight: true });

        console.log("Claim transaction signature", tx3);
    })

})