import os
import sys
import time
import json
import random
from datetime import datetime

try:
    import oci
except ImportError:
    print("OCI SDK is still installing. Please wait a moment.")
    sys.exit(1)

CONFIG_PATH = os.path.expanduser(r"~\.oci\config")
SSH_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIR7sVKOeXX/3WrVjtVnidD7GYu8WGYErKK3UbwB5PYQ bfi-classroom-oracle"
INSTANCE_NAME = "bfi-classroom-server"
BASE_INTERVAL_SECONDS = 55  # Safe baseline interval with natural jitter to protect account safety

def get_clients():
    config = oci.config.from_file(CONFIG_PATH, "DEFAULT")
    identity_client = oci.identity.IdentityClient(config)
    core_client = oci.core.ComputeClient(config)
    vn_client = oci.core.VirtualNetworkClient(config)
    return config, identity_client, core_client, vn_client

def get_or_create_network(config, vn_client):
    compartment_id = config["tenancy"]
    
    # Check existing VCNs
    vcns = vn_client.list_vcns(compartment_id).data
    target_vcn = None
    for vcn in vcns:
        if vcn.lifecycle_state == oci.core.models.Vcn.LIFECYCLE_STATE_AVAILABLE:
            target_vcn = vcn
            break
            
    if not target_vcn:
        print("[Network] Creating new VCN with internet connectivity...")
        vcn_details = oci.core.models.CreateVcnDetails(
            cidr_block="10.0.0.0/16",
            compartment_id=compartment_id,
            display_name="bfi-classroom-vcn"
        )
        target_vcn = vn_client.create_vcn(vcn_details).data
        print(f"[Network] VCN created: {target_vcn.id}")
        
    # Check internet gateway
    igws = vn_client.list_internet_gateways(compartment_id, vcn_id=target_vcn.id).data
    target_igw = None
    for igw in igws:
        if igw.is_enabled and igw.lifecycle_state == oci.core.models.InternetGateway.LIFECYCLE_STATE_AVAILABLE:
            target_igw = igw
            break
    if not target_igw:
        print("[Network] Creating Internet Gateway...")
        igw_details = oci.core.models.CreateInternetGatewayDetails(
            compartment_id=compartment_id,
            is_enabled=True,
            vcn_id=target_vcn.id,
            display_name="bfi-igw"
        )
        target_igw = vn_client.create_internet_gateway(igw_details).data
        
    # Ensure default route table routes 0.0.0.0/0 to IGW
    default_rt_id = target_vcn.default_route_table_id
    rt = vn_client.get_route_table(default_rt_id).data
    has_default_route = any(r.destination == "0.0.0.0/0" for r in rt.route_rules)
    if not has_default_route:
        print("[Network] Adding default route to Internet Gateway...")
        new_rules = list(rt.route_rules)
        new_rules.append(oci.core.models.RouteRule(
            destination="0.0.0.0/0",
            destination_type="CIDR_BLOCK",
            network_entity_id=target_igw.id
        ))
        vn_client.update_route_table(
            default_rt_id,
            oci.core.models.UpdateRouteTableDetails(route_rules=new_rules)
        )
        
    # Ensure default security list allows ports 22, 80, 443
    default_sl_id = target_vcn.default_security_list_id
    sl = vn_client.get_security_list(default_sl_id).data
    existing_ports = []
    for rule in sl.ingress_security_rules:
        if rule.tcp_options and rule.tcp_options.destination_port_range:
            existing_ports.append((rule.tcp_options.destination_port_range.min, rule.tcp_options.destination_port_range.max))
            
    needed_ports = [22, 80, 443]
    missing_ports = [p for p in needed_ports if not any(min_p <= p <= max_p for min_p, max_p in existing_ports)]
    if missing_ports:
        print(f"[Network] Opening ports {missing_ports} in Security List...")
        new_ingress = list(sl.ingress_security_rules)
        for p in missing_ports:
            new_ingress.append(oci.core.models.IngressSecurityRule(
                protocol="6",  # TCP
                source="0.0.0.0/0",
                tcp_options=oci.core.models.TcpOptions(
                    destination_port_range=oci.core.models.PortRange(min=p, max=p)
                )
            ))
        vn_client.update_security_list(
            default_sl_id,
            oci.core.models.UpdateSecurityListDetails(ingress_security_rules=new_ingress)
        )
        
    # Check public subnet
    subnets = vn_client.list_subnets(compartment_id, vcn_id=target_vcn.id).data
    target_subnet = None
    for sub in subnets:
        if not sub.prohibit_public_ip_on_vnic and sub.lifecycle_state == oci.core.models.Subnet.LIFECYCLE_STATE_AVAILABLE:
            target_subnet = sub
            break
            
    if not target_subnet:
        print("[Network] Creating Public Subnet...")
        subnet_details = oci.core.models.CreateSubnetDetails(
            compartment_id=compartment_id,
            vcn_id=target_vcn.id,
            cidr_block="10.0.0.0/24",
            display_name="bfi-public-subnet",
            route_table_id=default_rt_id,
            security_list_ids=[default_sl_id]
        )
        target_subnet = vn_client.create_subnet(subnet_details).data
        print(f"[Network] Public Subnet created: {target_subnet.id}")
        
    return target_subnet.id

def find_canonical_ubuntu_image(core_client, compartment_id, is_arm=True):
    if is_arm:
        return "ocid1.image.oc1.ap-singapore-1.aaaaaaaa4rgzowsv4u6hk6ugkk2be7ztbowlxwnonuvsxq4d73yjy4fc22ka"
    else:
        return "ocid1.image.oc1.ap-singapore-1.aaaaaaaa5ya4v6ywpra2wmoxepz4sdfczrwghmo3af33ds6awrwhdn5ubmhq"

def attempt_launch(core_client, compartment_id, ad_name, subnet_id, shape, is_arm, ocpus=2.0, memory_in_gbs=12.0):
    image_id = find_canonical_ubuntu_image(core_client, compartment_id, is_arm)
    if not image_id:
        print(f"[Claimer] Could not find Ubuntu image for {'ARM' if is_arm else 'x86'}")
        return None
        
    shape_config = None
    if shape == "VM.Standard.A1.Flex":
        shape_config = oci.core.models.LaunchInstanceShapeConfigDetails(
            ocpus=float(ocpus),
            memory_in_gbs=float(memory_in_gbs)
        )
        
    instance_details = oci.core.models.LaunchInstanceDetails(
        compartment_id=compartment_id,
        availability_domain=ad_name,
        shape=shape,
        display_name=INSTANCE_NAME,
        shape_config=shape_config,
        source_details=oci.core.models.InstanceSourceViaImageDetails(
            image_id=image_id,
            boot_volume_size_in_gbs=100  # Upgraded to 100 GB SSD (Always Free gives up to 200 GB)
        ),
        create_vnic_details=oci.core.models.CreateVnicDetails(
            subnet_id=subnet_id,
            assign_public_ip=True,
            display_name=f"{INSTANCE_NAME}-vnic"
        ),
        metadata={
            "ssh_authorized_keys": SSH_KEY
        }
    )
    
    return core_client.launch_instance(instance_details).data

def main():
    print("=" * 60)
    print("   BFI CLASSROOM — ORACLE CLOUD AUTOMATED INSTANCE CLAIMER")
    print("=" * 60)
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Connecting to Oracle Cloud Infrastructure...")
    
    try:
        config, identity_client, core_client, vn_client = get_clients()
        tenancy_id = config["tenancy"]
        
        # Test connection
        ads = identity_client.list_availability_domains(tenancy_id).data
        ad_name = ads[0].name
        print(f"[*] Connected successfully! Tenancy: {tenancy_id[:20]}...")
        print(f"[*] Region: {config['region']} | Availability Domain: {ad_name}")
    except Exception as e:
        print(f"[!] Authentication / Connection Error: {e}")
        return

    # Check existing instances
    instances = core_client.list_instances(tenancy_id).data
    for inst in instances:
        if inst.lifecycle_state in ["RUNNING", "PROVISIONING", "STARTING"]:
            print(f"[✓] Active instance already found: '{inst.display_name}' ({inst.lifecycle_state})")
            print("No need to claim a new one. Server is active!")
            return

    # Setup or fetch network
    try:
        subnet_id = get_or_create_network(config, vn_client)
        print(f"[*] Public Subnet ready: {subnet_id}")
    except Exception as e:
        print(f"[!] Error configuring network: {e}")
        return

    TARGET_CONFIGS = [
        {"desc": "12 GB RAM / 2 OCPU (Ampere ARM)", "shape": "VM.Standard.A1.Flex", "is_arm": True, "ocpus": 2.0, "ram": 12.0},
        {"desc": "6 GB RAM / 1 OCPU (Ampere ARM)", "shape": "VM.Standard.A1.Flex", "is_arm": True, "ocpus": 1.0, "ram": 6.0}
    ]

    print(f"\n[*] Starting Dual-Target Continuous Monitor (Ultra-Safe Mode)...")
    print(f"[*] Target A: 12 GB RAM / 2 OCPU (Ampere ARM)")
    print(f"[*] Target B: 6 GB RAM / 1 OCPU (Ampere ARM)")
    print(f"[*] Alternating targets every 50-65s to safely maximize claim speed.\n")

    attempt = 1
    config_idx = 0
    while True:
        target = TARGET_CONFIGS[config_idx]
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"[{timestamp}] Attempt #{attempt} requesting [{target['desc']}]...", end=" ", flush=True)
        
        instance_created = None
        try:
            inst = attempt_launch(
                core_client,
                tenancy_id,
                ad_name,
                subnet_id,
                target["shape"],
                target["is_arm"],
                ocpus=target["ocpus"],
                memory_in_gbs=target["ram"]
            )
            if inst:
                instance_created = inst
                print(f"\n[SUCCESS!] Instance launched successfully with {target['desc']}!")
                print(f"Instance ID: {inst.id}")
        except oci.exceptions.ServiceError as se:
            if "Out of host capacity" in se.message or "Out of capacity" in se.message:
                print("Capacity full. Will retry.")
            elif "Too many requests" in se.message:
                print("Rate limit caution received. Backing off safely for 2 minutes...")
                time.sleep(120)
            else:
                print(f"OCI Service Error: {se.message}")
        except Exception as ex:
            print(f"Error: {ex}")

        if instance_created:
            print("\n" + "=" * 60)
            print("   SERVER CREATED SUCCESSFULLY!")
            print("=" * 60)
            print("Waiting for instance to reach RUNNING state and acquire Public IP...")
            
            while True:
                time.sleep(10)
                cur_inst = core_client.get_instance(instance_created.id).data
                print(f"State: {cur_inst.lifecycle_state}...")
                if cur_inst.lifecycle_state == "RUNNING":
                    # Get public IP
                    vnics = core_client.list_vnic_attachments(compartment_id=tenancy_id, instance_id=cur_inst.id).data
                    if vnics:
                        vnic = vn_client.get_vnic(vnics[0].vnic_id).data
                        print("\n" + "*" * 50)
                        print(f"[!] PUBLIC IP ADDRESS: {vnic.public_ip}")
                        print("*" * 50)
                    break
            break
        else:
            sleep_time = BASE_INTERVAL_SECONDS + random.randint(0, 15)
            print(f"Sleeping {sleep_time}s safely before next check.")
            attempt += 1
            config_idx = (config_idx + 1) % len(TARGET_CONFIGS)
            time.sleep(sleep_time)

if __name__ == "__main__":
    main()
